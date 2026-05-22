import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, SourceKind } from "@/lib/types";

export interface RisingItem {
  id: string;
  source_id: string;
  url: string;
  title: string;
  summary: string | null;
  category: Category | null;
  importance: number | null;
  duplicate_count: number;
  published_at: string | null;
  delta: number;
  hours: number;
  velocity: number;
  source_slug: string;
  source_name: string;
  source_kind: SourceKind;
}

interface LoadOpts {
  windowHours?: number;
  minDelta?: number;
  maxRows?: number;
}

// Calls the rising_items SQL function with full row data. Failures are
// swallowed and logged — a flame badge / rising strip is a nice-to-have,
// not load-bearing, so a snapshot table that's still empty or a transient
// RPC error should never break the homepage render.
export async function loadRisingItems(
  supabase: SupabaseClient,
  opts: LoadOpts = {},
): Promise<RisingItem[]> {
  try {
    const { data, error } = await supabase.rpc("rising_items", {
      window_hours: opts.windowHours ?? 12,
      min_delta: opts.minDelta ?? 20,
      max_rows: opts.maxRows ?? 30,
    });
    if (error) {
      console.warn("rising_items rpc (display only, ignoring):", error.message);
      return [];
    }
    return (data ?? []) as RisingItem[];
  } catch (e) {
    console.warn("rising_items exception (display only):", (e as Error).message);
    return [];
  }
}

// Convenience: just the IDs, used by the cluster-flame-badge code path
// where we don't need source info.
export async function loadRisingItemIds(
  supabase: SupabaseClient,
  opts: LoadOpts = {},
): Promise<string[]> {
  const items = await loadRisingItems(supabase, opts);
  return items.map((r) => r.id).filter(Boolean);
}
