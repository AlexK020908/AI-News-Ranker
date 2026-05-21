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

export interface Storage {
  enabled: boolean;
  uploadThumbnail(
    sourceUrl: string,
    opts: { region: string; sourceSlug: string; externalId: string },
  ): Promise<UploadedThumbnail | null>;
  // Build the public URL for an existing key — used by render paths so we don't
  // need to store the URL separately if the bucket policy is public.
  publicUrl(key: string): string | null;
}

const NOOP: Storage = {
  enabled: false,
  async uploadThumbnail() {
    return null;
  },
  publicUrl() {
    return null;
  },
};

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

function makeS3Storage(deps: S3Deps): Storage {
  return {
    enabled: true,
    publicUrl(key) {
      return `${deps.publicBase}/${encodeURI(key)}`;
    },
    async uploadThumbnail(sourceUrl, { region, sourceSlug, externalId }) {
      let raw: ArrayBuffer;
      let sourceContentType: string;
      try {
        // Some publisher CDNs are slow and/or block scraper-y user agents.
        // 20s timeout + browser UA covers the common cases; thumbnails that
        // still fail get logged with the URL so they're easy to investigate.
        const resp = await fetch(sourceUrl, {
          signal: AbortSignal.timeout(20_000),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
          },
          redirect: "follow",
        });
        if (!resp.ok) {
          console.warn(`[storage] thumbnail fetch ${resp.status} for ${sourceUrl}`);
          return null;
        }
        sourceContentType = resp.headers.get("content-type") || "image/jpeg";
        if (!sourceContentType.startsWith("image/")) {
          console.warn(`[storage] non-image content-type ${sourceContentType} for ${sourceUrl}`);
          return null;
        }
        raw = await resp.arrayBuffer();
        if (raw.byteLength > MAX_SOURCE_BYTES) {
          console.warn(`[storage] source too large (${raw.byteLength}b) for ${sourceUrl}`);
          return null;
        }
      } catch (e) {
        console.warn(`[storage] thumbnail fetch failed (${sourceUrl}): ${(e as Error).message}`);
        return null;
      }

      const processed = await processImage(raw, sourceContentType, sourceUrl);
      if (!processed) return null;

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
        console.warn(`[storage] s3 put failed: ${(e as Error).message}`);
        return null;
      }

      return {
        key,
        url: `${deps.publicBase}/${encodeURI(key)}`,
        contentType: processed.contentType,
        byteLength: processed.body.byteLength,
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
