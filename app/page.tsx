import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCache, cacheKeys, ttl } from "@/lib/cache/redis";
import { loadStoryBuckets, type StoryBucket } from "@/lib/stories";
import { loadRisingItems, type RisingItem } from "@/lib/rising";
import { loadSoloItems } from "@/lib/solo-items";
import { loadTrendingRepos, type TrendingRepo } from "@/lib/trending-repos";
import { DEFAULT_REGION } from "@/lib/types";
import { clusterFromBucket } from "@/lib/stack/transform";
import { risingItemToStandalone } from "@/lib/stack/rising-transform";
import { trendingRepoToCard } from "@/lib/stack/trending-repo-transform";
import { StackApp } from "@/components/stack/StackApp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// MAX_TOPICS is the OVERFETCH ceiling, not the displayed cluster count.
// StackApp applies the user's category subset client-side AND a per-category
// quota for the topic-row layout, so we need enough headroom that every row
// fills up — not just the dominant categories.
//
// Pre-2026-05-22 we shipped MAX_TOPICS=24, then 72 after the rows layout
// shipped — but 72 still produced 1-2 cards/row in news/discussion/release
// because the global trending_score sort puts papers + repos at the top.
// 240 is empirically the smallest number that gives the long-tail
// categories enough candidates for the per-category slicer to fill rows
// of ~12 cards each without starving.
const MAX_TOPICS = 240;
// Widened again on 2026-05-22: was 45, now 25. News/release/announcement
// items routinely score 30-44 from Claude's importance rubric ("most items
// are 30-60"). Anything 30-44 was being silently dropped at the SQL gate
// before the per-category slicer even saw them, leaving news rows empty.
// 25 is the floor below which Claude's rubric explicitly marks items as
// "low-signal recycled content / marketing fluff" — anything that scores
// below that genuinely doesn't belong on the homepage.
const SOLO_DAYS = 4;
const SOLO_MAX = 200;
const SOLO_MIN_IMPORTANCE = 25;

// Trending repos shown on the home page only when the user has the "Repo"
// topic pill selected. Keeps the default All view from being flooded with
// GitHub cards while still surfacing them as a focused experience when
// the user explicitly wants repos. /repos remains the full 50-row view.
const HOME_REPOS_MIN_STARS = 1000;
const HOME_REPOS_DAYS = 7;
const HOME_REPOS_MAX = 12;

export default async function Home() {
  const region = DEFAULT_REGION;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return <StackApp clusters={[]} risingSingletons={[]} trendingRepos={[]} />;
  }

  const supabase = await createSupabaseServerClient();
  const cache = getCache();

  // Bucket + rising + solo + trending-repo loads run in parallel; the
  // first three share a coarse-grained TTL so cluster-member-IDs,
  // rising-IDs, and solo-IDs stay mutually consistent — mismatched
  // freshness produces false flame badges and items appearing twice
  // across the grid + strip. Trending repos load too but only render
  // when the user clicks the Repo topic pill (gated client-side).
  type SoloBucket = Omit<StoryBucket, "views_1h" | "clicks_1h">;
  const [buckets, rising, solos, trendingRepos] = await Promise.all([
    cache.remember<StoryBucket[]>(
      cacheKeys.stories(region, MAX_TOPICS),
      ttl.stories,
      () => loadStoryBuckets(supabase, { region, maxTopics: MAX_TOPICS, maxMembers: 8 }),
    ),
    cache.remember<RisingItem[]>(
      cacheKeys.rising(12, 20, 30),
      ttl.rising,
      () => loadRisingItems(supabase),
    ),
    cache.remember<SoloBucket[]>(
      cacheKeys.solo(region, SOLO_DAYS, SOLO_MAX, SOLO_MIN_IMPORTANCE),
      ttl.solo,
      () => loadSoloItems(supabase, {
        region,
        daysBack: SOLO_DAYS,
        maxRows: SOLO_MAX,
        minImportance: SOLO_MIN_IMPORTANCE,
      }),
    ),
    cache.remember<TrendingRepo[]>(
      cacheKeys.trendingRepos(HOME_REPOS_MIN_STARS, HOME_REPOS_DAYS, HOME_REPOS_MAX),
      ttl.trendingRepos,
      () => loadTrendingRepos(supabase, {
        minStars: HOME_REPOS_MIN_STARS,
        daysBack: HOME_REPOS_DAYS,
        maxRows:  HOME_REPOS_MAX,
      }),
    ),
  ]);

  // Solo items already arrive shaped as story_buckets. Decorate them with
  // the engagement-count fields the StoryBucket type carries (always zero
  // here — solos don't have aggregated 1h view/click counters) so the
  // unified array stays consistently typed.
  const soloBuckets: StoryBucket[] = solos.map((s) => ({
    ...s,
    views_1h: 0,
    clicks_1h: 0,
  }));

  // Concat real clusters + solo pseudo-clusters, then sort by trending_score
  // and trim to MAX_TOPICS. A fresh importance-90 solo will outrank an older
  // small cluster, and vice versa — the cluster job's MIN_CLUSTER_SIZE gate
  // no longer suppresses solo visibility; it just chooses which surface the
  // item lives on.
  const merged = [...buckets, ...soloBuckets]
    .sort((a, b) => b.trending_score - a.trending_score)
    .slice(0, MAX_TOPICS);

  // Build the set of item IDs already represented in any cluster member,
  // including the solo pseudo-clusters — keeps rising-strip cards from
  // duplicating items shown in the main grid.
  const clusterMemberIds = new Set<string>();
  for (const b of merged) {
    for (const m of b.members) clusterMemberIds.add(m.id);
  }
  const risingSet = new Set(rising.map((r) => r.id));
  const clusters = merged.map((b) => clusterFromBucket(b, risingSet));
  const risingSingletons = rising
    .filter((r) => !clusterMemberIds.has(r.id))
    .slice(0, 8)
    .map(risingItemToStandalone);
  const trendingRepoCards = trendingRepos
    .filter((r) => !clusterMemberIds.has(r.id))
    .map(trendingRepoToCard);

  return (
    <StackApp
      clusters={clusters}
      risingSingletons={risingSingletons}
      trendingRepos={trendingRepoCards}
    />
  );
}
