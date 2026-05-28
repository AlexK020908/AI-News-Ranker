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
// How long a listwise rerank (Stage 3) stays authoritative. The rerank job runs
// hourly; past this window a rank is treated as stale and the bucket falls back
// to trending_score order, so a skipped/failed pass degrades gracefully.
const RERANK_FRESH_HOURS = 3;
const SOLO_DAYS = 7;
const SOLO_MAX = 200;
const SOLO_MIN_IMPORTANCE = 25;
const HOME_REPOS_MIN_STARS = 1000;
const HOME_REPOS_DAYS = 7;
const HOME_REPOS_MAX = 12;

export interface HomeData {
  clusters: StackCluster[];
  risingSingletons: RisingStandalone[];
  trendingRepos: TrendingRepoCard[];
  // ISO timestamp of the freshest story on the page — emitted as the homepage's
  // schema.org dateModified so search engines date the snippet to real content
  // freshness instead of their last crawl. Render time when the feed is empty.
  lastModified: string;
}

export async function loadHomeData(): Promise<HomeData> {
  const region = DEFAULT_REGION;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { clusters: [], risingSingletons: [], trendingRepos: [], lastModified: new Date().toISOString() };
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

  // Ordering: stories with a FRESH listwise rerank lead the page in the model's
  // comparative order (rerank_rank asc). Everything else — solo items and topics
  // not in the latest rerank pass — follows by trending_score. This is the
  // Stage-3 payoff: relative judgment (reliable) over isolated per-item scores.
  //
  // Guard: only TOPICS with >=2 members are rerank candidates, so a hot solo
  // item never gets a rank. Without a check it would be pinned below every
  // reranked cluster regardless of how strongly it's trending. So a non-reranked
  // bucket whose trending_score beats the strongest reranked story is allowed to
  // float above the reranked block — the safety valve for a genuinely huge solo
  // the editor pass never saw. freshRank is computed ONCE per bucket here (not
  // per comparison) so the sort doesn't re-parse reranked_at O(n log n) times.
  const rerankCutoff = Date.now() - RERANK_FRESH_HOURS * 3_600_000;
  const freshRankOf = (b: StoryBucket): number | null => {
    if (b.rerank_rank == null || !b.reranked_at) return null;
    const ts = Date.parse(b.reranked_at);
    if (Number.isNaN(ts) || ts < rerankCutoff) return null;
    return b.rerank_rank;
  };
  const decorated = [...buckets, ...soloBuckets].map((b) => ({
    b,
    rank: freshRankOf(b),
  }));
  const maxRerankTrending = decorated.reduce(
    (m, d) => (d.rank != null && d.b.trending_score > m ? d.b.trending_score : m),
    Number.NEGATIVE_INFINITY,
  );
  const merged = decorated
    .sort((x, y) => {
      if (x.rank != null && y.rank != null) return x.rank - y.rank;
      if (x.rank != null) {
        // x reranked, y not: y wins only if it out-trends the whole rerank set.
        return y.b.trending_score > maxRerankTrending ? 1 : -1;
      }
      if (y.rank != null) {
        return x.b.trending_score > maxRerankTrending ? -1 : 1;
      }
      return y.b.trending_score - x.b.trending_score;
    })
    .map((d) => d.b)
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

  // Freshest member publish time across the page → homepage dateModified.
  let freshestMs = 0;
  for (const b of merged) {
    for (const m of b.members) {
      const t = m.published_at ? Date.parse(m.published_at) : 0;
      if (t > freshestMs) freshestMs = t;
    }
  }
  const lastModified =
    freshestMs > 0 ? new Date(freshestMs).toISOString() : new Date().toISOString();

  return { clusters, risingSingletons, trendingRepos: trendingRepoCards, lastModified };
}
