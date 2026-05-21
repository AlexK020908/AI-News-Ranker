// Generic crawler adapter for publishers without RSS. All knobs live in
// sources.crawl_config jsonb — see CrawlConfig interface below. Output is
// the same RawIngestedItem shape RSS produces.

import * as cheerio from "cheerio";
import { truncate } from "@/lib/utils";
import type { Adapter, IngestRawItem } from "./types";
import { USER_AGENT } from "./types";
import { serializeItemXml } from "./xml";

interface CrawlConfig {
  base_url: string;
  item_selector: string;
  title_selector?: string;
  link_selector?: string;
  link_attr?: string;
  summary_selector?: string;
  date_selector?: string;
  date_attr?: string;
  thumb_selector?: string;
  thumb_attr?: string;
  url_prefix?: string;
  max_items?: number;
}

function readCrawlConfig(raw: Record<string, unknown>): CrawlConfig | string {
  const base_url = typeof raw.base_url === "string" ? raw.base_url.trim() : "";
  const item_selector = typeof raw.item_selector === "string" ? raw.item_selector.trim() : "";
  if (!base_url) return "crawler: missing crawl_config.base_url";
  if (!item_selector) return "crawler: missing crawl_config.item_selector";
  return {
    base_url,
    item_selector,
    title_selector: optStr(raw.title_selector),
    link_selector: optStr(raw.link_selector),
    link_attr: optStr(raw.link_attr) ?? "href",
    summary_selector: optStr(raw.summary_selector),
    date_selector: optStr(raw.date_selector),
    date_attr: optStr(raw.date_attr),
    thumb_selector: optStr(raw.thumb_selector),
    thumb_attr: optStr(raw.thumb_attr) ?? "src",
    url_prefix: optStr(raw.url_prefix),
    max_items: typeof raw.max_items === "number" ? raw.max_items : 40,
  };
}

function optStr(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function absolutize(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export const crawlerAdapter: Adapter = async (ctx) => {
  const parsed = readCrawlConfig(ctx.crawlConfig);
  if (typeof parsed === "string") return { items: [], error: parsed };
  const cfg = parsed;

  let html: string;
  try {
    const resp = await fetch(cfg.base_url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!resp.ok) {
      return { items: [], error: `crawler: ${cfg.base_url} -> HTTP ${resp.status}` };
    }
    html = await resp.text();
  } catch (e) {
    return { items: [], error: `crawler: fetch failed — ${(e as Error).message}` };
  }

  const $ = cheerio.load(html);
  const baseForRel = cfg.url_prefix ?? new URL(cfg.base_url).origin;

  const items: IngestRawItem[] = [];
  const seen = new Set<string>();
  const titleSel = cfg.title_selector ?? "h2, h3, h4, a";

  $(cfg.item_selector).each((_, el) => {
    if (items.length >= (cfg.max_items ?? 40)) return false;

    const $el = $(el);

    // Title
    const $title = $el.find(titleSel).first();
    const title = ($title.text() || $el.attr("title") || "").trim();
    if (!title) return;

    let href: string | undefined;
    if (cfg.link_selector) {
      href = $el.find(cfg.link_selector).first().attr(cfg.link_attr ?? "href");
    } else if ($title.is("a")) {
      href = $title.attr("href");
    } else {
      href = $el.find("a").first().attr("href") ?? $el.attr("href");
    }
    if (!href) return;
    const url = absolutize(href, baseForRel);
    if (seen.has(url)) return;
    seen.add(url);

    // Summary
    let summary: string | null = null;
    if (cfg.summary_selector) {
      const s = $el.find(cfg.summary_selector).first().text().trim();
      if (s) summary = s;
    }

    // Date
    let publishedIso: string | null = null;
    if (cfg.date_selector) {
      const $d = $el.find(cfg.date_selector).first();
      const dateStr =
        (cfg.date_attr && $d.attr(cfg.date_attr)) || $d.text().trim();
      if (dateStr) {
        const parsedDate = new Date(dateStr);
        if (!Number.isNaN(parsedDate.getTime())) {
          publishedIso = parsedDate.toISOString();
        }
      }
    }

    // Thumbnail
    let thumbnail: string | null = null;
    if (cfg.thumb_selector) {
      const t = $el.find(cfg.thumb_selector).first().attr(cfg.thumb_attr ?? "src");
      if (t) thumbnail = absolutize(t, baseForRel);
    }

    // External ID: use the canonical URL itself — stable across re-crawls and
    // satisfies the (source_id, external_id) unique constraint.
    const externalId = url.slice(0, 400);

    items.push({
      external_id: externalId,
      url,
      title: truncate(title, 500),
      content: summary ? truncate(summary, 4000) : null,
      published_at: publishedIso,
      thumbnail_candidate_url: thumbnail,
      xml: serializeItemXml({
        guid: externalId,
        link: url,
        title,
        pubDate: publishedIso,
        description: summary ?? "",
        thumbnail,
        attrs: { source: "crawler" },
      }),
      raw: { crawled_at: new Date().toISOString(), base_url: cfg.base_url },
    });
  });

  if (items.length === 0) {
    return {
      items: [],
      error: `crawler: 0 items matched selector "${cfg.item_selector}" at ${cfg.base_url}`,
    };
  }
  return { items };
};
