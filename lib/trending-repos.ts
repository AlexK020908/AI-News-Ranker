import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, SourceKind } from "@/lib/types";

export interface TrendingRepo {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  category: Category | null;
  importance: number | null;
  published_at: string | null;
  stars: number;
  language: string | null;
  topics: string[];
  s3_storage_id: string | null;
  thumb_url: string | null;
  source_slug: string;
  source_name: string;
  source_kind: SourceKind;
}

export type HumanLang = "english" | "chinese" | "japanese" | "korean";

export interface RepoFilters {
  minStars?: number;
  daysBack?: number;
  maxRows?: number;
  // Exact-match against the repo's primary language (GitHub canonical casing).
  language?: string | null;
  // Membership test against the repo's GitHub topic tags array.
  topic?: string | null;
  // Human language of the original GitHub description — detected via
  // Unicode regex at query time, not stored.
  humanLang?: HumanLang | null;
}

// Solo high-star GitHub repos that aren't part of any cluster. Optional
// language + topic filters are pushed all the way down to the RPC so the
// 50-row cap means "top 50 matching the filter" rather than "top 50, then
// narrowed". Failures are swallowed — a missing strip never breaks render.
export async function loadTrendingRepos(
  supabase: SupabaseClient,
  opts: RepoFilters = {},
): Promise<TrendingRepo[]> {
  try {
    const { data, error } = await supabase.rpc("trending_solo_repos", {
      min_stars:     opts.minStars ?? 1000,
      days_back:     opts.daysBack ?? 7,
      max_rows:      opts.maxRows  ?? 12,
      in_language:   opts.language  ?? null,
      in_topic:      opts.topic     ?? null,
      in_human_lang: opts.humanLang ?? null,
    });
    if (error) {
      console.warn("trending_solo_repos rpc (display only, ignoring):", error.message);
      return [];
    }
    // `topics` arrives as jsonb (array); the JS client gives it back as a
    // plain JS array, but tolerate the unlikely string-encoded case too.
    return ((data ?? []) as Array<Omit<TrendingRepo, "topics"> & { topics: unknown }>).map((r) => ({
      ...r,
      topics: Array.isArray(r.topics)
        ? (r.topics as string[])
        : typeof r.topics === "string"
          ? safeParseTopics(r.topics)
          : [],
    }));
  } catch (e) {
    console.warn("trending_solo_repos exception (display only):", (e as Error).message);
    return [];
  }
}

function safeParseTopics(s: string): string[] {
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
