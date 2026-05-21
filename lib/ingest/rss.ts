import Parser from "rss-parser";
import { stripHtml, truncate } from "@/lib/utils";
import type { Adapter } from "./types";
import { USER_AGENT } from "./types";
import { readStringConfig } from "./http";
import { serializeItemXml } from "./xml";

// rss-parser supports custom fields, but the media:* extensions are slightly
// finicky across feed dialects. We register the common image-bearing ones so
// the parsed item carries them through.
const parser = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent": USER_AGENT,
    Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
  },
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumbnail"],
      ["itunes:image", "itunesImage"],
    ],
  },
});

// rss-parser returns `{ _: string, $: attrs }` when an element carries XML
// attributes (e.g. <guid isPermaLink="false">…</guid>). Coerce to a plain string.
function rssString(val: unknown, fallback = ""): string {
  if (typeof val === "string") return val;
  if (val && typeof val === "object" && "_" in val) {
    return String((val as { _?: unknown })._ ?? fallback);
  }
  return fallback;
}

function extractThumbnail(it: Record<string, unknown>): string | null {
  const enclosure = it.enclosure as { url?: string; type?: string } | undefined;
  if (enclosure?.url && (enclosure.type ?? "").startsWith("image/")) {
    return enclosure.url;
  }
  const mt = it.mediaThumbnail as
    | { $?: { url?: string } }
    | Array<{ $?: { url?: string } }>
    | undefined;
  if (Array.isArray(mt)) {
    for (const entry of mt) {
      if (entry?.$?.url) return entry.$.url;
    }
  } else if (mt?.$?.url) {
    return mt.$.url;
  }
  const mc = it.mediaContent as
    | { $?: { url?: string; type?: string; medium?: string } }
    | Array<{ $?: { url?: string; type?: string; medium?: string } }>
    | undefined;
  const mcArr = Array.isArray(mc) ? mc : mc ? [mc] : [];
  for (const entry of mcArr) {
    const $ = entry?.$;
    if (!$?.url) continue;
    if (($.type ?? "").startsWith("image/") || $.medium === "image") return $.url;
  }
  const itunes = it.itunesImage as { $?: { href?: string } } | undefined;
  if (itunes?.$?.href) return itunes.$.href;
  for (const key of ["image", "thumbnail"]) {
    const v = it[key];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
    if (v && typeof v === "object" && "url" in v) {
      const u = (v as { url?: unknown }).url;
      if (typeof u === "string") return u;
    }
  }
  return null;
}

export const rssAdapter: Adapter = async (ctx) => {
  const url = readStringConfig(ctx, "url").trim();
  if (!url) return { items: [], error: "rss: missing config.url" };

  try {
    const feed = await parser.parseURL(url);
    const items = (feed.items ?? [])
      .map((parsedItem) => {
        // The customFields parameterization narrows rss-parser's Item type in
        // a way that loses the string indexer + a few base fields. Treat the
        // parsed item as a loose record at the boundary.
        const it = parsedItem as unknown as Record<string, unknown>;
        const link = rssString(it.link ?? it.guid).trim();
        const title = (typeof it.title === "string" ? it.title : "").trim();
        if (!link || !title) return null;
        const externalId = rssString(it.guid, link).slice(0, 400);
        const pub =
          (typeof it.isoDate === "string" && it.isoDate) ||
          (typeof it.pubDate === "string" && it.pubDate) ||
          null;
        const rawHtml =
          (typeof it.content === "string" && it.content) ||
          (typeof it["content:encoded"] === "string" && (it["content:encoded"] as string)) ||
          (typeof it.summary === "string" && it.summary) ||
          "";
        const snippet =
          (typeof it.contentSnippet === "string" && it.contentSnippet
            ? it.contentSnippet
            : stripHtml(String(rawHtml))
          ).trim();
        const thumbnail = extractThumbnail(it);
        const xml = serializeItemXml({
          guid: externalId,
          link,
          title,
          pubDate: pub,
          description: snippet,
          thumbnail,
        });
        const author =
          (typeof it.creator === "string" && it.creator) ||
          (typeof it.author === "string" && it.author) ||
          null;
        return {
          external_id: externalId,
          url: link,
          title: truncate(title, 500),
          author: author as string | null,
          content: snippet ? truncate(snippet, 4000) : null,
          published_at: pub ? new Date(pub).toISOString() : null,
          xml,
          thumbnail_candidate_url: thumbnail,
          raw: { categories: Array.isArray(it.categories) ? it.categories : [] },
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    return { items };
  } catch (e) {
    return { items: [], error: `rss: ${(e as Error).message}` };
  }
};
