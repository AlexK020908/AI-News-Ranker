import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoryBucket } from "@/lib/stories";

// [n] → the post(s) to open on X for that inline citation.
export interface XBriefCitation {
  label: string;
  posts: { url: string; handle: string }[];
}

export interface XBrief {
  markdown: string;
  generated_at: string;
  // Keyed by the [n] markers in `markdown`. Null on older briefs.
  citations: Record<string, XBriefCitation> | null;
}

// The "On X today" synthesis that sits atop the cluster grid. Latest row for
// surface='x', written by /api/jobs/x-brief. Display-only: returns null on any
// error/absence so the page falls back to the clusters alone.
export async function loadLatestXBrief(
  supabase: SupabaseClient,
): Promise<XBrief | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select("markdown, generated_at, citations")
    .eq("surface", "x")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("loadLatestXBrief:", error.message);
    return null;
  }
  return data ? (data as XBrief) : null;
}

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
