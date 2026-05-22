import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_DAYS = 14;
// Snapshots are much higher-volume than items (one row per re-ingest tick
// per re-seen URL) and are only useful for short-window velocity. Default
// to 7 days — the rising_items RPC's largest sensible window is well
// under 24h, so a week is plenty of headroom for ad-hoc analysis.
const SNAPSHOT_DEFAULT_DAYS = 7;

export function retentionDays(): number {
  const v = Number(process.env.ITEM_RETENTION_DAYS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DAYS;
}

export function snapshotRetentionDays(): number {
  const v = Number(process.env.SNAPSHOT_RETENTION_DAYS);
  return Number.isFinite(v) && v > 0 ? v : SNAPSHOT_DEFAULT_DAYS;
}

export function retentionCutoffIso(): string {
  const ms = retentionDays() * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

export function snapshotCutoffIso(): string {
  const ms = snapshotRetentionDays() * 24 * 60 * 60 * 1000;
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

// Snapshots are extra-volatile data: rising_items only looks back hours,
// so anything older than a week is dead weight. Prune in the same tick
// as item pruning so volume stays bounded.
export async function pruneOldSnapshots(
  supabase: SupabaseClient,
): Promise<{ deleted: number; cutoff: string }> {
  const cutoff = snapshotCutoffIso();
  const { count, error } = await supabase
    .from("item_metric_snapshots")
    .delete({ count: "exact" })
    .lt("observed_at", cutoff);
  if (error) throw new Error(`prune snapshots: ${error.message}`);
  return { deleted: count ?? 0, cutoff };
}
