import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCache, ttl } from "@/lib/cache/redis";
import { loadXBuckets, loadLatestXBrief, type XBrief } from "@/lib/x";
import type { StoryBucket } from "@/lib/stories";
import { clusterFromBucket } from "@/lib/stack/transform";
import { XPage } from "@/components/stack/XPage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type XBucket = Omit<StoryBucket, "views_1h" | "clicks_1h">;

// Dedicated X / Twitter section. Tweet clusters + solo tweets are computed
// offline (cluster-tweets → x_topics) and read here, completely separate from
// the article feed on /.
export default async function X() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return <XPage clusters={[]} />;
  }

  const supabase = await createSupabaseServerClient();
  const cache = getCache();

  const [buckets, brief] = await Promise.all([
    cache.remember<XBucket[]>(
      "x:buckets:v1",
      ttl.stories,
      () => loadXBuckets(supabase),
    ),
    cache.remember<XBrief | null>(
      "x:brief:v1",
      ttl.stories,
      () => loadLatestXBrief(supabase),
    ),
  ]);

  // Decorate with the engagement-count fields StoryBucket carries (always zero
  // for the X surface — tweets have no aggregated view/click counters here) so
  // the shared transform stays consistently typed.
  const clusters = buckets.map((b) =>
    clusterFromBucket({ ...b, views_1h: 0, clicks_1h: 0 }),
  );

  return <XPage clusters={clusters} brief={brief?.markdown ?? null} />;
}
