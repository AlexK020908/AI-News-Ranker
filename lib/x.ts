import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoryBucket } from "@/lib/stories";

// Loader for the dedicated /x section. Returns tweet CLUSTERS ("what X is
// talking about", linking related takes) plus notable SOLO tweets, both in the
// story_buckets row shape so the page reuses the existing StoryBucket →
// StackCluster transform and ClusterCard rendering. Clusters first (they're the
// signal), then solo tweets by trending_score — same merge the homepage does.
//
// Display-only: a failed RPC logs + returns what it has rather than 500-ing the
// page, mirroring loadStoryBuckets / loadSoloItems.

type XBucket = Omit<StoryBucket, "views_1h" | "clicks_1h">;

interface LoadOpts {
  maxClusters?: number;
  maxMembers?: number;
  soloDays?: number;
  maxSolo?: number;
  soloMinImportance?: number;
}

export async function loadXBuckets(
  supabase: SupabaseClient,
  opts: LoadOpts = {},
): Promise<XBucket[]> {
  const {
    maxClusters = 60,
    maxMembers = 8,
    soloDays = 2,
    maxSolo = 40,
    soloMinImportance = 35,
  } = opts;

  const [clustersRes, soloRes] = await Promise.all([
    supabase.rpc("x_story_buckets", { max_topics: maxClusters, max_members: maxMembers }),
    supabase.rpc("x_solo_tweets", {
      days_back: soloDays,
      max_rows: maxSolo,
      min_importance: soloMinImportance,
    }),
  ]);

  const clusters: XBucket[] = clustersRes.error
    ? (console.warn("x_story_buckets rpc:", clustersRes.error.message), [])
    : ((clustersRes.data ?? []) as XBucket[]);

  const solos: XBucket[] = soloRes.error
    ? (console.warn("x_solo_tweets rpc:", soloRes.error.message), [])
    : ((soloRes.data ?? []) as XBucket[]);

  // Clusters are the headline; solo tweets fill in beneath, sorted by their own
  // trending_score. No global re-sort — a multi-account cluster should outrank a
  // lone hot take even when the solo's raw score is higher.
  return [...clusters, ...solos];
}
