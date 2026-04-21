import { truncate } from "@/lib/utils";
import type { Adapter } from "./types";
import { fetchJson, readNumberConfig, readStringConfig } from "./http";
import { hnEngagement } from "./engagement";

interface HNHit {
  objectID: string;
  title: string | null;
  url: string | null;
  author: string;
  points: number;
  num_comments: number;
  created_at: string;
  story_text?: string | null;
}

export const hackernewsAdapter: Adapter = async (ctx) => {
  const query = readStringConfig(ctx, "query");
  const minPoints = readNumberConfig(ctx, "min_points", 100);

  const u = new URL("https://hn.algolia.com/api/v1/search_by_date");
  u.searchParams.set("tags", "story");
  u.searchParams.set("hitsPerPage", "50");
  u.searchParams.set("numericFilters", `points>=${minPoints}`);
  if (query) u.searchParams.set("query", query);

  try {
    const json = await fetchJson<{ hits: HNHit[] }>(u.toString());
    const items = (json.hits ?? [])
      .filter((h) => h.title)
      .map((h) => ({
        external_id: `hn:${h.objectID}`,
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: truncate(h.title!, 500),
        author: h.author,
        content:
          truncate(
            [h.story_text ?? "", `${h.points} pts · ${h.num_comments} comments`]
              .filter(Boolean)
              .join("\n\n"),
            4000,
          ) || null,
        published_at: h.created_at,
        engagement_score: hnEngagement(h.points, h.num_comments),
        raw: { points: h.points, num_comments: h.num_comments },
      }));
    return { items };
  } catch (e) {
    return { items: [], error: `hn: ${(e as Error).message}` };
  }
};
