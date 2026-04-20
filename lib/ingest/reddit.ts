import { truncate } from "@/lib/utils";
import type { Adapter } from "./types";
import { fetchJson, readNumberConfig, readStringConfig } from "./http";

interface RedditChild {
  data: {
    id: string;
    title: string;
    url_overridden_by_dest?: string;
    permalink: string;
    author: string;
    score: number;
    num_comments: number;
    created_utc: number;
    selftext?: string;
    link_flair_text?: string | null;
    subreddit: string;
    over_18?: boolean;
    stickied?: boolean;
  };
}

export const redditAdapter: Adapter = async (ctx) => {
  const sub = readStringConfig(ctx, "subreddit");
  if (!sub) return { items: [], error: "reddit: missing subreddit" };
  const minScore = readNumberConfig(ctx, "min_score", 0);
  const t = readStringConfig(ctx, "time", "day");
  const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/top.json?t=${t}&limit=50`;

  try {
    const json = await fetchJson<{ data?: { children: RedditChild[] } }>(url);
    const children = json.data?.children ?? [];
    const items = children
      .filter((c) => !c.data.stickied && !c.data.over_18 && c.data.score >= minScore)
      .map((c) => {
        const d = c.data;
        const isExternal =
          !!d.url_overridden_by_dest && !d.url_overridden_by_dest.includes("reddit.com");
        const permalink = `https://www.reddit.com${d.permalink}`;
        return {
          external_id: `r:${d.subreddit}:${d.id}`,
          url: isExternal ? d.url_overridden_by_dest! : permalink,
          title: truncate(d.title, 500),
          author: d.author,
          content:
            truncate(
              [
                d.selftext?.trim() || "",
                `r/${d.subreddit} · ${d.score} pts · ${d.num_comments} comments`,
                d.link_flair_text ? `flair: ${d.link_flair_text}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              4000,
            ) || null,
          published_at: new Date(d.created_utc * 1000).toISOString(),
          raw: {
            subreddit: d.subreddit,
            score: d.score,
            comments: d.num_comments,
            flair: d.link_flair_text ?? null,
          },
        };
      });
    return { items };
  } catch (e) {
    return { items: [], error: `reddit: ${(e as Error).message}` };
  }
};
