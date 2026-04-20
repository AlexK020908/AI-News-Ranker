import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestRawItem } from "./types";
import { sha256Hex } from "@/lib/utils";

const INSERT_CHUNK = 100;

export async function upsertItems(
  supabase: SupabaseClient,
  sourceId: string,
  items: IngestRawItem[],
): Promise<{ inserted: number; skipped: number }> {
  if (items.length === 0) return { inserted: 0, skipped: 0 };

  // De-dupe within the batch first — same URL can appear twice in one feed.
  const byUrl = new Map<string, IngestRawItem>();
  for (const it of items) {
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

  return { inserted, skipped: unique.length - inserted };
}
