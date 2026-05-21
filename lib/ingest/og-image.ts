// Thumbnail-candidate fallbacks for items whose source didn't carry an image.
//
// Two strategies:
//   1. githubRepoOgImage — deterministic URL on opengraph.githubassets.com for
//      github.com/{owner}/{repo}. The same card you see when pasting a repo
//      link into Slack/Twitter (README banner + owner avatar + stars).
//   2. fetchPageOgImage — fetch the article HTML and pull og:image /
//      twitter:image / link rel=image_src. Used when an RSS feed omits the
//      media:* tags but the publisher's page still has good OG metadata.
//
// Both are intentionally side-effect-free besides one bounded HTTP call so the
// enrich pool can drive them in parallel.

import * as cheerio from "cheerio";

const PAGE_FETCH_TIMEOUT_MS = 10_000;
// og:image lives in <head>; cap reads so a misbehaving server can't blow up
// memory. 1.5MB is enough headroom for the largest sane document head.
const MAX_HTML_BYTES = 1_500_000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function githubRepoOgImage(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  // Only canonical /{owner}/{repo} — skip /{owner}/{repo}/issues/123, /pull/45,
  // /tree/main/..., gists, marketplace, etc. Those don't have a useful card.
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) return null;
  return `https://opengraph.githubassets.com/1/${owner}/${repo}`;
}

export async function fetchPageOgImage(url: string): Promise<string | null> {
  let html: string;
  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!resp.ok) return null;
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("html")) return null;

    const buf = await resp.arrayBuffer();
    const trimmed = buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
    html = new TextDecoder("utf-8", { fatal: false }).decode(trimmed);
  } catch {
    return null;
  }

  return extractOgImageFromHtml(html, url);
}

export function extractOgImageFromHtml(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);
  const candidates = [
    $('meta[property="og:image"]').attr("content"),
    $('meta[property="og:image:url"]').attr("content"),
    $('meta[property="og:image:secure_url"]').attr("content"),
    $('meta[name="twitter:image"]').attr("content"),
    $('meta[name="twitter:image:src"]').attr("content"),
    $('link[rel="image_src"]').attr("href"),
  ];
  for (const c of candidates) {
    if (!c) continue;
    const cleaned = c.trim();
    if (!cleaned) continue;
    try {
      return new URL(cleaned, baseUrl).toString();
    } catch {
      // malformed URL on the meta tag — try the next candidate
    }
  }
  return null;
}
