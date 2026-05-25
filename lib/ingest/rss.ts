import Parser from "rss-parser";
import * as cheerio from "cheerio";
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

const TECHMEME_HOST = /(^|\.)techmeme\.com$/i;

function isTechmemeUrl(u: string): boolean {
  try {
    return TECHMEME_HOST.test(new URL(u).hostname);
  } catch {
    return false;
  }
}

// Techmeme's feed points <link>/<guid> at a permalink page
// (techmeme.com/260524/p16#a260524p16) rather than the underlying article, and
// carries the thumbnail inline in the description HTML instead of via media:*
// tags. The description leads with an anchor wrapping the image:
//   <a href="REAL_ARTICLE"><img src="http://www.techmeme.com/260524/i16.jpg"></a>
// We lift the real article URL + thumbnail out of there so cards link through
// to the source and get a usable image. Scoped to techmeme.com links so it
// can't hijack the <link> of a normal feed whose body happens to embed images.
// http://… → https://…, and protocol-relative //host/… → https://host/… so a
// schemeless src can't slip through to the thumbnail fetcher unupgraded.
function toHttps(src: string): string {
  if (src.startsWith("//")) return `https:${src}`;
  return src.replace(/^http:\/\//i, "https://");
}

function extractTechmemeTarget(
  html: string,
): { url: string; thumbnail: string | null } | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  // Collect every external anchor that wraps an <img>. A Techmeme description
  // can contain more than the lead anchor ("More:"/"Discussion:"/related-story
  // links), so don't just take the first one.
  const candidates: Array<{ url: string; src: string }> = [];
  $("a").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    if (!href || isTechmemeUrl(href)) return;
    const src = ($(el).find("img").first().attr("src") || "").trim();
    if (!src) return;
    candidates.push({ url: href, src });
  });
  if (candidates.length === 0) return null;
  // The headline anchor wraps the Techmeme-hosted lead thumbnail
  // (techmeme.com/<id>/iNN.jpg). Prefer it so a related external link carrying
  // its own (non-techmeme) image can't hijack the rewrite; fall back to the
  // first image anchor if Techmeme ever stops self-hosting the thumbnail.
  const lead = candidates.find((c) => isTechmemeUrl(c.src)) ?? candidates[0];
  return { url: lead.url, thumbnail: toHttps(lead.src) };
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
        let finalLink = link;
        let thumbnail = extractThumbnail(it);
        // Techmeme: <link> is a permalink page; rewrite to the real article and
        // pull the inline thumbnail the feed doesn't expose via media:* tags.
        if (isTechmemeUrl(link)) {
          const tm = extractTechmemeTarget(String(rawHtml));
          if (tm) {
            finalLink = tm.url;
            if (!thumbnail) thumbnail = tm.thumbnail;
          }
        }
        const xml = serializeItemXml({
          guid: externalId,
          link: finalLink,
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
          url: finalLink,
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
