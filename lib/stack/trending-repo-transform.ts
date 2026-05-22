import type { TrendingRepo } from "@/lib/trending-repos";
import { avatarFor, hueFor } from "./sources";

// Display shape for the Trending Repos strip. Reuses the rising-card
// CSS but swaps velocity for star count — fresh solo repos have no
// snapshot history, so we surface them on raw star magnitude instead.
export interface TrendingRepoCard {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  stars: number;
  hoursAgo: number;
  language: string | null;
  // Capped to the top N for compact card display; the SQL returns the full
  // GitHub topic list and the transform trims it.
  topics: string[];
  source: {
    slug: string;
    name: string;
    kind: string;
    initial: string;
    color: string;
    text?: string;
    hue: number;
  };
}

const MAX_DISPLAY_TOPICS = 4;

function hoursAgoFrom(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 3_600_000));
}

export function trendingRepoToCard(r: TrendingRepo): TrendingRepoCard {
  const avatar = avatarFor(r.source_slug, r.source_name);
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    summary: r.summary,
    stars: r.stars,
    hoursAgo: hoursAgoFrom(r.published_at),
    language: r.language,
    topics: r.topics.slice(0, MAX_DISPLAY_TOPICS),
    source: {
      slug: r.source_slug,
      name: r.source_name,
      kind: r.source_kind,
      initial: avatar.initial,
      color: avatar.color,
      text: avatar.text,
      hue: hueFor(r.source_slug),
    },
  };
}
