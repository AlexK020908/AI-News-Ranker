import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_DAYS = 14;

export function retentionDays(): number {
  const v = Number(process.env.ITEM_RETENTION_DAYS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAYS;
}

export function retentionCutoffIso(): string {
  const ms = retentionDays() * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

// Deletes items older than the retention cutoff. Rows with null published_at
// are kept — we don't know when they were published, so we treat them as fresh.
export async function pruneOldItems(
  supabase: SupabaseClient,
): Promise<{ deleted: number; cutoff: string }> {
  const cutoff = retentionCutoffIso();
  const { count, error } = await supabase
    .from("items")
    .delete({ count: "exact" })
    .lt("published_at", cutoff);
  if (error) throw new Error(`prune: ${error.message}`);
  return { deleted: count ?? 0, cutoff };
}
