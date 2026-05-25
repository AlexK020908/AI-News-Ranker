import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestRawItem } from "./types";
import { sha256Hex } from "@/lib/utils";
import { retentionCutoffIso } from "./retention";

const INSERT_CHUNK = 100;
// Lookup chunks are smaller than insert chunks: PostgREST encodes .in() as a
// query param, so 100 long URLs (arXiv abstract URLs, GitHub repo URLs with
// org/name, long RSS GUIDs) can push the request URI over the 8KB default
// limit at common proxies (nginx, Cloudflare, AWS ALB). 25 keeps us safe.
const LOOKUP_CHUNK = 25;

export interface UpsertOpts {
  // Default region for the source — applied when the item doesn't carry its own.
  defaultRegion: string;
}

interface ExistingItem {
  id: string;
  url: string;
}

interface SnapshotRow {
  item_id: string;
  points: number | null;
  comments: number | null;
}

// Pulls numeric signals out of raw. HN gives points + num_comments, GH
// gives stars, future Reddit adapter will give ups + num_comments. Returns
// null/null when no signal is present (arXiv, RSS, HuggingFace) — those
// items get no snapshot, since velocity has nothing to track.
function extractSnapshotSignals(raw: Record<string, unknown> | undefined): {
  points: number | null;
  comments: number | null;
} {
  if (!raw) return { points: null, comments: null };
  const pointsCandidates = [raw.points, raw.stars, raw.ups];
  const commentsCandidates = [raw.num_comments, raw.comments];
  const num = (xs: unknown[]): number | null => {
    for (const x of xs) {
      if (typeof x === "number" && Number.isFinite(x)) return x;
    }
    return null;
  };
  return { points: num(pointsCandidates), comments: num(commentsCandidates) };
}

export async function upsertItems(
  supabase: SupabaseClient,
  sourceId: string,
  items: IngestRawItem[],
  opts: UpsertOpts,
): Promise<{ inserted: number; skipped: number; snapshots: number; snapshot_errors: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0, snapshots: 0, snapshot_errors: 0 };

  // Drop items older than the retention window so they never land in the DB
  // (saves Haiku enrichment cost on stale backfill from full-history feeds).
  // Null published_at = unknown age, keep.
  const cutoff = retentionCutoffIso();
  const recent = items.filter((i) => !i.published_at || i.published_at >= cutoff);

  // De-dupe within the batch first — same URL can appear twice in one feed.
  const byUrl = new Map<string, IngestRawItem>();
  for (const it of recent) {
    if (!byUrl.has(it.url)) byUrl.set(it.url, it);
  }
  const unique = Array.from(byUrl.values());
  if (unique.length === 0) {
    return { inserted: 0, skipped: items.length, snapshots: 0, snapshot_errors: 0 };
  }

  // Find URLs that already exist — those become snapshot-only writes
  // instead of inserts. Smaller chunks defend against the proxy URL-length
  // limit since this is a GET.
  const urls = unique.map((i) => i.url);
  const urlToId = new Map<string, string>();
  for (let i = 0; i < urls.length; i += LOOKUP_CHUNK) {
    const slice = urls.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from("items")
      .select("id, url")
      .in("url", slice);
    if (error) throw new Error(`lookup existing: ${error.message}`);
    for (const row of (data ?? []) as ExistingItem[]) {
      urlToId.set(row.url, row.id);
    }
  }

  // Guard the SECOND unique constraint, items_source_external_unique
  // (source_id, external_id). An item whose url changed since first ingest —
  // e.g. Techmeme rewriting a permalink's lead article (lib/ingest/rss.ts) —
  // passes the url lookup above as "new", then violates (source_id,
  // external_id) on insert; onConflict:"url" doesn't catch it, so the whole
  // chunk throws (line below) and the source's ingest tick aborts. Pre-fetch
  // existing external_ids for this source and treat them as already-seen:
  // keep the existing row rather than inserting a colliding duplicate.
  const externalIds = unique.map((i) => i.external_id);
  const seenExternalIds = new Set<string>();
  for (let i = 0; i < externalIds.length; i += LOOKUP_CHUNK) {
    const slice = externalIds.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from("items")
      .select("external_id")
      .eq("source_id", sourceId)
      .in("external_id", slice);
    if (error) throw new Error(`lookup existing external_id: ${error.message}`);
    for (const row of (data ?? []) as { external_id: string }[]) {
      seenExternalIds.add(row.external_id);
    }
  }

  const newItems = unique.filter(
    (i) => !urlToId.has(i.url) && !seenExternalIds.has(i.external_id),
  );

  const rows = await Promise.all(
    newItems.map(async (i) => {
      // Carry the thumbnail candidate through `raw` so the enrich step can find
      // it without a separate column. Schema stays minimal.
      const raw: Record<string, unknown> = { ...(i.raw ?? {}) };
      if (i.thumbnail_candidate_url) {
        raw.thumbnail_candidate_url = i.thumbnail_candidate_url;
      }
      return {
        source_id: sourceId,
        external_id: i.external_id,
        url: i.url,
        title: i.title,
        author: i.author ?? null,
        content: i.content ?? null,
        content_hash: await sha256Hex(
          [i.title, i.url, (i.content ?? "").slice(0, 2000)].join("\x1f"),
        ),
        published_at: i.published_at ?? null,
        engagement_score: i.engagement_score ?? 0,
        raw,
        region: i.region ?? opts.defaultRegion,
        xml: i.xml ?? null,
      };
    }),
  );

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const { data, error } = await supabase
      .from("items")
      .upsert(chunk, { onConflict: "url", ignoreDuplicates: true })
      .select("id, url");
    if (error) throw new Error(`insert: ${error.message}`);
    for (const row of (data ?? []) as ExistingItem[]) {
      urlToId.set(row.url, row.id);
      inserted++;
    }
  }

  // If any URL we thought was new came back without an inserted row, it
  // lost a race with a concurrent ingest worker. Look those up so they
  // still get a snapshot this tick.
  const stillMissing = newItems
    .map((i) => i.url)
    .filter((u) => !urlToId.has(u));
  if (stillMissing.length > 0) {
    for (let i = 0; i < stillMissing.length; i += LOOKUP_CHUNK) {
      const slice = stillMissing.slice(i, i + LOOKUP_CHUNK);
      const { data } = await supabase
        .from("items")
        .select("id, url")
        .in("url", slice);
      for (const row of (data ?? []) as ExistingItem[]) {
        urlToId.set(row.url, row.id);
      }
    }
  }

  // Score-velocity snapshots. We write a row for EVERY ingest observation
  // of an item with numeric signals — first observation included, so
  // rising_items() can fire after one re-sighting instead of two. The PK
  // (item_id, observed_at) with the server-side now() default protects
  // against duplicate-within-statement collisions.
  const snapshotRows: SnapshotRow[] = [];
  for (const it of unique) {
    const sig = extractSnapshotSignals(it.raw);
    if (sig.points == null && sig.comments == null) continue;
    const itemId = urlToId.get(it.url);
    if (!itemId) continue;
    snapshotRows.push({
      item_id: itemId,
      points: sig.points,
      comments: sig.comments,
    });
  }

  let snapshots = 0;
  let snapshotErrors = 0;
  for (let i = 0; i < snapshotRows.length; i += INSERT_CHUNK) {
    const chunk = snapshotRows.slice(i, i + INSERT_CHUNK);
    // ignoreDuplicates makes (item_id, observed_at) collisions benign:
    // two ticks landing inside the same now() bucket drop the dup.
    // .select() on the upsert returns only newly-inserted rows so the
    // count is accurate (not an upper bound).
    const { data, error } = await supabase
      .from("item_metric_snapshots")
      .upsert(chunk, { onConflict: "item_id,observed_at", ignoreDuplicates: true })
      .select("item_id");
    if (error) {
      // Don't fail the whole ingest on a snapshot error, and don't
      // silently truncate either — count + continue so the caller sees
      // both partial success AND the error rate.
      console.error("snapshot insert failed:", error.message);
      snapshotErrors += chunk.length;
      continue;
    }
    snapshots += data?.length ?? 0;
  }

  return {
    inserted,
    skipped: items.length - inserted,
    snapshots,
    snapshot_errors: snapshotErrors,
  };
}
