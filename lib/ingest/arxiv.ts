import Parser from "rss-parser";
import { truncate } from "@/lib/utils";
import type { Adapter } from "./types";
import { USER_AGENT } from "./types";
import { readNumberConfig, readStringConfig } from "./http";

type ArxivItem = { summary?: string; id?: string };

const parser = new Parser<Record<string, never>, ArxivItem>({
  timeout: 20_000,
  customFields: {
    item: [
      ["summary", "summary"],
      ["id", "id"],
    ],
  },
  headers: { "User-Agent": USER_AGENT },
});

export const arxivAdapter: Adapter = async (ctx) => {
  const category = readStringConfig(ctx, "category", "cs.AI");
  const max = readNumberConfig(ctx, "max_results", 50);
  const url = `http://export.arxiv.org/api/query?search_query=cat:${encodeURIComponent(category)}&sortBy=submittedDate&sortOrder=descending&max_results=${max}`;

  try {
    const feed = await parser.parseURL(url);
    const items = (feed.items ?? [])
      .map((it) => {
        const arxivId = (it.id || it.link || "").trim();
        const link = it.link || arxivId;
        if (!link || !it.title) return null;
        const shortId = arxivId.replace(/^https?:\/\/arxiv\.org\/abs\//, "").slice(0, 200);
        const pub = it.isoDate || it.pubDate || null;
        const summary = (it.summary || "").trim().replace(/\s+/g, " ");
        const author = typeof it.creator === "string" ? it.creator : null;
        return {
          external_id: shortId || link,
          url: link,
          title: truncate((it.title ?? "").trim(), 500),
          author,
          content: summary ? truncate(summary, 4000) : null,
          published_at: pub ? new Date(pub).toISOString() : null,
          raw: { category, arxiv_id: shortId },
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    return { items };
  } catch (e) {
    return { items: [], error: `arxiv: ${(e as Error).message}` };
  }
};
