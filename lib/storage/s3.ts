// S3-compatible thumbnail storage (AWS / R2 / MinIO).
// Stores ONLY thumbnails — raw XML lives inline on items.xml.
// No-op fallback when S3_BUCKET is unset.
//
// On upload, source images are resized through sharp to a max of 800px wide
// and re-encoded as WebP (q80). Publishers often serve full-resolution hero
// images (10–25MB JPEGs); storing those as-is would waste S3 bytes and ship
// huge payloads to the frontend for a card thumbnail. SVGs bypass the
// processing step — they're already vector + small.

import type {
  S3Client as AwsS3Client,
  PutObjectCommandInput,
} from "@aws-sdk/client-s3";

// Source bytes we'll accept before refusing the upload. Resize makes the
// stored object small, but we still need to hold the source in memory while
// sharp runs.
const MAX_SOURCE_BYTES = 25_000_000;
const TARGET_WIDTH_PX = 800;
const TARGET_QUALITY = 80;

export interface UploadedThumbnail {
  key: string;       // S3 object key, stored in items.s3_storage_id
  url: string;       // Public-ish URL (presigned or direct, depending on bucket policy)
  contentType: string;
  byteLength: number;
}

// Outcome categories for a thumbnail upload attempt:
//   - "uploaded":  success; caller writes key to items.s3_storage_id
//   - "blocked":   host's circuit breaker is tripped (no fetch attempted);
//                  caller leaves the row untouched — it doesn't count toward
//                  retry exhaustion because nothing was actually tried
//   - "transient": rate-limit, 5xx, network timeout, S3 put fail — caller
//                  increments a retry counter; row stays eligible until the
//                  counter exceeds the cap, then it dead-letters
//   - "permanent": 404, oversize, non-image content-type, processing fail —
//                  caller dead-letters immediately
export type UploadOutcome = "uploaded" | "blocked" | "transient" | "permanent";

export interface UploadResult {
  outcome: UploadOutcome;
  thumbnail?: UploadedThumbnail;
  reason: string;
}

export interface Storage {
  enabled: boolean;
  uploadThumbnail(
    sourceUrl: string,
    opts: { region: string; sourceSlug: string; externalId: string },
  ): Promise<UploadResult>;
  // Build the public URL for an existing key — used by render paths so we don't
  // need to store the URL separately if the bucket policy is public.
  publicUrl(key: string): string | null;
}

const NOOP: Storage = {
  enabled: false,
  async uploadThumbnail() {
    return { outcome: "transient", reason: "no bucket configured" };
  },
  publicUrl() {
    return null;
  },
};

// Per-host pacing for hosts that rate-limit aggressively. opengraph.github
// assets.com caps at ~100 req/min — 850ms between calls keeps us at ~70/min
// with comfortable headroom. Other hosts go unthrottled.
const HOST_MIN_INTERVAL_MS: Record<string, number> = {
  "opengraph.githubassets.com": 850,
};

// Per-host promise chain. Each new caller chains its work onto the previous
// caller's lock, and the lock is released minMs after the fetch starts so
// the next caller sees that gap. Process-local — fine for a single Next.js
// runtime, would need a shared store under multi-instance deploys.
const hostChains = new Map<string, Promise<void>>();

async function throttleForHost(host: string | null): Promise<void> {
  if (!host) return;
  const minMs = HOST_MIN_INTERVAL_MS[host];
  if (!minMs) return;
  const prev = hostChains.get(host) ?? Promise.resolve();
  let release: (() => void) | null = null;
  const mine = new Promise<void>((r) => {
    release = r;
  });
  hostChains.set(host, mine);
  await prev;
  // Hold the lock for minMs after acquisition so the next caller waits that
  // long before its fetch starts. release is assigned synchronously in the
  // Promise executor above, so the non-null assertion is safe.
  setTimeout(() => release!(), minMs);
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function parseRetryAfterMs(value: string | null): number {
  if (!value) return 60_000;
  const secs = Number(value);
  if (Number.isFinite(secs)) return clamp(secs * 1000, 5_000, 120_000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return clamp(date - Date.now(), 5_000, 120_000);
  return 60_000;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Per-host circuit breaker. Once a host 429s, we stop trying that host for
// the Retry-After window — subsequent requests within the block return
// transient immediately instead of stacking 60s sleeps inside the route.
// Process-local; would need a shared store under multi-instance deploys.
const hostBlockedUntil = new Map<string, number>();

function hostBlockedRemainingMs(host: string | null): number {
  if (!host) return 0;
  const until = hostBlockedUntil.get(host);
  if (until === undefined) return 0;
  return Math.max(0, until - Date.now());
}

function tripBreaker(host: string | null, ms: number): void {
  if (!host) return;
  const existing = hostBlockedUntil.get(host) ?? 0;
  const until = Date.now() + ms;
  // Don't shrink an existing block window — keep the longest pending reset.
  if (until > existing) hostBlockedUntil.set(host, until);
}

// Snapshot of currently-blocked hosts. Callers use this to filter rows out
// of backfill queries so the same rate-limited rows don't keep filling
// every batch.
export function getBlockedHosts(): Array<{ host: string; secondsRemaining: number }> {
  const now = Date.now();
  const result: Array<{ host: string; secondsRemaining: number }> = [];
  for (const [host, until] of hostBlockedUntil) {
    const remaining = until - now;
    if (remaining > 0) {
      result.push({ host, secondsRemaining: Math.ceil(remaining / 1000) });
    }
  }
  return result;
}

let cached: Storage | null = null;

export function getStorage(): Storage {
  if (cached) return cached;
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    cached = NOOP;
    return cached;
  }

  // Lazy-require so envs without S3 don't pay the import cost.
  let mod: typeof import("@aws-sdk/client-s3");
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("@aws-sdk/client-s3");
  } catch {
    console.warn("[storage] S3_BUCKET set but @aws-sdk/client-s3 not installed — falling back to no-op");
    cached = NOOP;
    return cached;
  }

  const region = process.env.S3_REGION ?? "us-east-1";
  const endpoint = process.env.S3_ENDPOINT || undefined; // undefined → real AWS
  const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true";

  const client = new mod.S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined, // fall back to the AWS default credential chain
  });

  const publicBase =
    process.env.S3_PUBLIC_BASE_URL?.replace(/\/$/, "") ||
    (endpoint
      ? `${endpoint.replace(/\/$/, "")}/${bucket}`
      : `https://${bucket}.s3.${region}.amazonaws.com`);

  cached = makeS3Storage({ client, bucket, publicBase, PutObjectCommand: mod.PutObjectCommand });
  return cached;
}

interface S3Deps {
  client: AwsS3Client;
  bucket: string;
  publicBase: string;
  PutObjectCommand: typeof import("@aws-sdk/client-s3").PutObjectCommand;
}

// Cached sharp module — native dep, loaded lazily once. sharp uses
// `export = sharp` (CommonJS), so it's loaded via require to match how the
// AWS SDK is handled above.
type SharpFactory = typeof import("sharp");
let sharpFactory: SharpFactory | null = null;
let sharpLoadFailed = false;

function getSharp(): SharpFactory | null {
  if (sharpFactory) return sharpFactory;
  if (sharpLoadFailed) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sharpFactory = require("sharp") as SharpFactory;
    return sharpFactory;
  } catch (e) {
    sharpLoadFailed = true;
    console.warn(`[storage] sharp not available — uploads will skip resize: ${(e as Error).message}`);
    return null;
  }
}

interface ProcessedImage {
  body: Uint8Array;
  contentType: string;
  ext: string;
}

async function processImage(
  raw: ArrayBuffer,
  sourceContentType: string,
  sourceUrl: string,
): Promise<ProcessedImage | null> {
  // SVGs are already small + vector; storing them as-is preserves crispness
  // at every zoom level, where rasterizing to WebP would hurt.
  if (sourceContentType.includes("svg")) {
    return { body: new Uint8Array(raw), contentType: "image/svg+xml", ext: "svg" };
  }

  const sharp = getSharp();
  if (!sharp) {
    // No sharp available — store the original, but only if it's small enough
    // that we don't want to ship a 20MB JPEG to the frontend.
    if (raw.byteLength > 2_000_000) {
      console.warn(
        `[storage] sharp unavailable and source too large to store as-is (${raw.byteLength}b) for ${sourceUrl}`,
      );
      return null;
    }
    return {
      body: new Uint8Array(raw),
      contentType: sourceContentType,
      ext: guessExt(sourceContentType),
    };
  }

  try {
    const processed = await sharp(Buffer.from(raw), { animated: false })
      .rotate() // honor EXIF orientation before resizing
      .resize({
        width: TARGET_WIDTH_PX,
        withoutEnlargement: true,
        fit: "inside",
      })
      .webp({ quality: TARGET_QUALITY })
      .toBuffer();
    return {
      body: new Uint8Array(processed),
      contentType: "image/webp",
      ext: "webp",
    };
  } catch (e) {
    console.warn(`[storage] sharp processing failed for ${sourceUrl}: ${(e as Error).message}`);
    return null;
  }
}

// Source-fetch result, with the categorization needed by the caller to
// decide whether to dead-letter.
type SourceFetchResult =
  | { kind: "ok"; body: ArrayBuffer; contentType: string }
  | { kind: "blocked"; reason: string }
  | { kind: "transient"; reason: string }
  | { kind: "permanent"; reason: string };

async function fetchSourceWithRetry(sourceUrl: string): Promise<SourceFetchResult> {
  const host = hostnameOf(sourceUrl);

  // Circuit breaker: if this host recently 429'd, skip the network round-trip
  // entirely. The next backfill round will pick the row up after the window
  // resets. "blocked" is distinct from "transient" so it doesn't count toward
  // the retry-exhaustion threshold.
  const blockedMs = hostBlockedRemainingMs(host);
  if (blockedMs > 0) {
    return { kind: "blocked", reason: `host blocked for ${Math.ceil(blockedMs / 1000)}s` };
  }

  await throttleForHost(host);

  let resp: Response;
  try {
    resp = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
      },
      redirect: "follow",
    });
  } catch (e) {
    return { kind: "transient", reason: `fetch failed: ${(e as Error).message}` };
  }

  if (resp.status === 429) {
    // Trip the breaker and bail. We don't sleep + retry in-process because
    // that stacks up across the request pool (50 rows × 60s = 50 minutes).
    // Letting the script loop instead spreads the work cleanly.
    const wait = parseRetryAfterMs(resp.headers.get("retry-after"));
    tripBreaker(host, wait);
    console.warn(`[storage] 429 from ${host ?? "?"}; blocking host for ${Math.ceil(wait / 1000)}s`);
    return { kind: "transient", reason: `429 (host blocked ${Math.ceil(wait / 1000)}s)` };
  }
  if (resp.status >= 500) {
    return { kind: "transient", reason: `HTTP ${resp.status}` };
  }
  if (!resp.ok) {
    return { kind: "permanent", reason: `HTTP ${resp.status}` };
  }
  const contentType = resp.headers.get("content-type") || "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return { kind: "permanent", reason: `non-image content-type ${contentType}` };
  }
  let body: ArrayBuffer;
  try {
    body = await resp.arrayBuffer();
  } catch (e) {
    return { kind: "transient", reason: `body read failed: ${(e as Error).message}` };
  }
  if (body.byteLength > MAX_SOURCE_BYTES) {
    return { kind: "permanent", reason: `source too large (${body.byteLength}b)` };
  }
  return { kind: "ok", body, contentType };
}

function makeS3Storage(deps: S3Deps): Storage {
  return {
    enabled: true,
    publicUrl(key) {
      return `${deps.publicBase}/${encodeURI(key)}`;
    },
    async uploadThumbnail(sourceUrl, { region, sourceSlug, externalId }) {
      const fetched = await fetchSourceWithRetry(sourceUrl);
      if (fetched.kind !== "ok") {
        console.warn(`[storage] thumbnail ${fetched.kind} for ${sourceUrl}: ${fetched.reason}`);
        return { outcome: fetched.kind, reason: fetched.reason };
      }

      const processed = await processImage(fetched.body, fetched.contentType, sourceUrl);
      if (!processed) {
        // Image-decode / resize failures are usually malformed-source —
        // permanent. (sharp init failures are caught higher up.)
        return { outcome: "permanent", reason: "image processing failed" };
      }

      const safeId = externalId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
      const key = `thumbs/${region}/${sourceSlug}/${safeId}.${processed.ext}`;

      const input: PutObjectCommandInput = {
        Bucket: deps.bucket,
        Key: key,
        Body: processed.body,
        ContentType: processed.contentType,
        CacheControl: "public, max-age=86400, immutable",
      };

      try {
        await deps.client.send(new deps.PutObjectCommand(input));
      } catch (e) {
        // S3-side failures are typically transient (network blip, throttling,
        // signature drift on credential rotation). Don't dead-letter.
        const reason = `s3 put failed: ${(e as Error).message}`;
        console.warn(`[storage] ${reason}`);
        return { outcome: "transient", reason };
      }

      return {
        outcome: "uploaded",
        reason: "ok",
        thumbnail: {
          key,
          url: `${deps.publicBase}/${encodeURI(key)}`,
          contentType: processed.contentType,
          byteLength: processed.body.byteLength,
        },
      };
    },
  };
}

function guessExt(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  if (ct.includes("avif")) return "avif";
  return "jpg";
}
