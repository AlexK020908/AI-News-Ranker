import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoryBucket } from "@/lib/stories";

interface LoadOpts {
  region: string;
  daysBack?: number;
  maxRows?: number;
  minImportance?: number;
}

// Notable enriched items that aren't yet in any topic cluster, returned
// in the same row shape as story_buckets() so the homepage can concat +
// sort by trending_score with no special-casing. Each row is a one-
// member "pseudo-cluster".
//
// Display-only: a failed RPC returns [] rather than breaking the page.
export async function loadSoloItems(
  supabase: SupabaseClient,
  opts: LoadOpts,
): Promise<Omit<StoryBucket, "views_1h" | "clicks_1h">[]> {
  try {
    const { data, error } = await supabase.rpc("notable_solo_items", {
      in_region:      opts.region,
      days_back:      opts.daysBack ?? 2,
      max_rows:       opts.maxRows ?? 24,
      min_importance: opts.minImportance ?? 60,
    });
    if (error) {
      console.warn("notable_solo_items rpc (display only, ignoring):", error.message);
      return [];
    }
    return (data ?? []) as Omit<StoryBucket, "views_1h" | "clicks_1h">[];
  } catch (e) {
    console.warn("notable_solo_items exception (display only):", (e as Error).message);
    return [];
  }
}
