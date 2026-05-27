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
import type { StackCluster } from "@/lib/stack/types";
import type { RisingStandalone } from "@/lib/stack/rising-transform";
import type { TrendingRepoCard } from "@/lib/stack/trending-repo-transform";

const MAX_TOPICS = 240;
const SOLO_DAYS = 4;
const SOLO_MAX = 200;
const SOLO_MIN_IMPORTANCE = 25;
const HOME_REPOS_MIN_STARS = 1000;
const HOME_REPOS_DAYS = 7;
const HOME_REPOS_MAX = 12;

export interface HomeData {
  clusters: StackCluster[];
  risingSingletons: RisingStandalone[];
  trendingRepos: TrendingRepoCard[];
}

export async function loadHomeData(): Promise<HomeData> {
  const region = DEFAULT_REGION;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { clusters: [], risingSingletons: [], trendingRepos: [] };
  }

  const supabase = await createSupabaseServerClient();
  const cache = getCache();

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
        maxRows: HOME_REPOS_MAX,
      }),
    ),
  ]);

  const soloBuckets: StoryBucket[] = solos.map((s) => ({
    ...s,
    views_1h: 0,
    clicks_1h: 0,
  }));

  const merged = [...buckets, ...soloBuckets]
    .sort((a, b) => b.trending_score - a.trending_score)
    .slice(0, MAX_TOPICS);

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

  return { clusters, risingSingletons, trendingRepos: trendingRepoCards };
}
