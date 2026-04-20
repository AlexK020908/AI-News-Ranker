import Parser from "rss-parser";
import { stripHtml, truncate } from "@/lib/utils";
import type { Adapter } from "./types";
import { USER_AGENT } from "./types";
import { readStringConfig } from "./http";

const parser = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent": USER_AGENT,
    Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
  },
});

export const rssAdapter: Adapter = async (ctx) => {
  const url = readStringConfig(ctx, "url").trim();
  if (!url) return { items: [], error: "rss: missing config.url" };

  try {
    const feed = await parser.parseURL(url);
    const items = (feed.items ?? [])
      .map((it) => {
        const link = (it.link || it.guid || "").trim();
        const title = (it.title || "").trim();
        if (!link || !title) return null;
        const externalId = (it.guid || link).slice(0, 400);
        const pub = it.isoDate || it.pubDate || null;
        const raw = it.content || it["content:encoded"] || it.summary || "";
        const snippet = (it.contentSnippet || stripHtml(String(raw))).trim();
        return {
          external_id: externalId,
          url: link,
          title: truncate(title, 500),
          author: (it.creator || it.author || null) as string | null,
          content: snippet ? truncate(snippet, 4000) : null,
          published_at: pub ? new Date(pub).toISOString() : null,
          raw: { categories: it.categories ?? [] },
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    return { items };
  } catch (e) {
    return { items: [], error: `rss: ${(e as Error).message}` };
  }
};
