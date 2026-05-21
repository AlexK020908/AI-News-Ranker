import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCache, cacheKeys, ttl } from "@/lib/cache/redis";
import { loadStoryBuckets, type StoryBucket } from "@/lib/stories";
import { DEFAULT_REGION } from "@/lib/types";
import { clusterFromBucket } from "@/lib/stack/transform";
import { StackApp } from "@/components/stack/StackApp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const region = DEFAULT_REGION;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return <StackApp clusters={[]} />;
  }

  const supabase = await createSupabaseServerClient();
  const cache = getCache();

  const buckets = await cache.remember<StoryBucket[]>(
    cacheKeys.stories(region, 24),
    ttl.stories,
    () => loadStoryBuckets(supabase, { region, maxTopics: 24, maxMembers: 8 }),
  );

  const clusters = buckets.map(clusterFromBucket);
  return <StackApp clusters={clusters} />;
}
