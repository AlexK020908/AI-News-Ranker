import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCache, cacheKeys, ttl } from "@/lib/cache/redis";
import { loadStoryBuckets, type StoryBucket } from "@/lib/stories";
import { loadRisingItems, type RisingItem } from "@/lib/rising";
import { DEFAULT_REGION } from "@/lib/types";
import { clusterFromBucket } from "@/lib/stack/transform";
import { risingItemToStandalone } from "@/lib/stack/rising-transform";
import { StackApp } from "@/components/stack/StackApp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const region = DEFAULT_REGION;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return <StackApp clusters={[]} risingSingletons={[]} />;
  }

  const supabase = await createSupabaseServerClient();
  const cache = getCache();

  // Both calls use the same TTL so cluster-member-IDs and rising-IDs
  // are mutually consistent — mismatched freshness produces false flame
  // badges and duplicates between the strip and the cluster grid.
  const [buckets, rising] = await Promise.all([
    cache.remember<StoryBucket[]>(
      cacheKeys.stories(region, 24),
      ttl.stories,
      () => loadStoryBuckets(supabase, { region, maxTopics: 24, maxMembers: 8 }),
    ),
    cache.remember<RisingItem[]>(
      cacheKeys.rising(12, 20, 30),
      ttl.rising,
      () => loadRisingItems(supabase),
    ),
  ]);

  // Build the set of item IDs already represented in any cluster member.
  // Singletons = rising items NOT in any cluster — these get their own
  // strip below the main grid so we don't lose visibility of hot solo
  // repos / HN threads / etc.
  const clusterMemberIds = new Set<string>();
  for (const b of buckets) {
    for (const m of b.members) clusterMemberIds.add(m.id);
  }
  const risingSet = new Set(rising.map((r) => r.id));
  const clusters = buckets.map((b) => clusterFromBucket(b, risingSet));
  const risingSingletons = rising
    .filter((r) => !clusterMemberIds.has(r.id))
    .slice(0, 8)
    .map(risingItemToStandalone);

  return <StackApp clusters={clusters} risingSingletons={risingSingletons} />;
}
