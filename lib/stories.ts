import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, SourceKind } from "@/lib/types";

export interface StoryMember {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  category: Category | null;
  importance: number | null;
  published_at: string | null;
  region: string;
  duplicate_count: number;
  source_slug: string;
  source_name: string;
  source_kind: SourceKind;
  // Thumbnail wiring. s3_storage_id is the durable copy (set when S3_BUCKET is
  // configured during enrich); thumb_url is the publisher's original CDN URL
  // captured during ingest. The transform layer prefers s3 when present.
  s3_storage_id: string | null;
  thumb_url: string | null;
  // Plain-English paper explanation. Null for non-papers.
  caveman_summary?: string | null;
}

export interface StoryBucket {
  topic_id: string;
  topic_slug: string;
  topic_label: string;
  topic_summary: string | null;
  member_count: number;
  avg_importance: number | null;
  max_importance: number | null;
  trending_score: number;
  last_updated_at: string;
  members: StoryMember[];
  // Engagement metrics — collected for display + analytics only.
  // NOT used for ranking. See README for the "Camp B" rationale.
  views_1h: number;
  clicks_1h: number;
}

interface LoadOpts {
  region: string;
  maxTopics: number;
  maxMembers: number;
}

// We deliberately do NOT factor views/clicks into ranking. Cross-source
// corroboration (the trending_score computed in cluster-topics) is the gold-
// standard anti-manipulation signal — you can't bot N independent reputable
// AI publishers into covering the same story. Views, by contrast, are
// trivial to inflate. Engagement here is attached for tooltip/analytics
// purposes; if the product later wants to surface "X viewers" badges, the
// data is already on the StoryBucket. Switching it back into ranking would
// be a one-line change but should be done only with a serious bot-prevention
// stack in place (Turnstile, signed cookies, source-diversity weighting).
const ENGAGEMENT_WINDOW_HOURS = 1;

export async function loadStoryBuckets(
  supabase: SupabaseClient,
  opts: LoadOpts,
): Promise<StoryBucket[]> {
  try {
    const [bucketsRes, engagementRes] = await Promise.all([
      supabase.rpc("story_buckets", {
        in_region:   opts.region,
        max_topics:  opts.maxTopics,
        max_members: opts.maxMembers,
      }),
      supabase.rpc("engaged_topics", { window_hours: ENGAGEMENT_WINDOW_HOURS }),
    ]);

    if (bucketsRes.error) {
      console.error("story_buckets rpc:", bucketsRes.error.message);
      return [];
    }

    const engagement = new Map<string, { views: number; clicks: number }>();
    if (engagementRes.error) {
      console.warn("engaged_topics rpc (display only, ignoring):", engagementRes.error.message);
    } else {
      for (const row of (engagementRes.data ?? []) as Array<{
        topic_id: string;
        unique_hourly_views: number | string;
        unique_hourly_clicks: number | string;
      }>) {
        engagement.set(row.topic_id, {
          views: Number(row.unique_hourly_views) || 0,
          clicks: Number(row.unique_hourly_clicks) || 0,
        });
      }
    }

    // story_buckets() already returns rows ordered by trending_score desc.
    // We just attach engagement counts for display; no re-sort.
    const raw = (bucketsRes.data ?? []) as Omit<StoryBucket, "views_1h" | "clicks_1h">[];
    return raw.map((b) => {
      const e = engagement.get(b.topic_id);
      return { ...b, views_1h: e?.views ?? 0, clicks_1h: e?.clicks ?? 0 };
    });
  } catch (e) {
    console.error("loadStoryBuckets exception:", (e as Error).message);
    return [];
  }
}
