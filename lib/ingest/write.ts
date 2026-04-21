import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestRawItem } from "./types";
import { sha256Hex } from "@/lib/utils";
import { retentionCutoffIso } from "./retention";

const INSERT_CHUNK = 100;

export async function upsertItems(
  supabase: SupabaseClient,
  sourceId: string,
  items: IngestRawItem[],
): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };

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

  const rows = await Promise.all(
    unique.map(async (i) => ({
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
      raw: i.raw ?? {},
    })),
  );

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK);
    const { data, error } = await supabase
      .from("items")
      .upsert(chunk, { onConflict: "url", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`upsert: ${error.message}`);
    inserted += data?.length ?? 0;
  }

  return { inserted, skipped: items.length - inserted };
}
