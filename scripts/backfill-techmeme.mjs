#!/usr/bin/env node
// One-time backfill for Techmeme rows ingested before the rss.ts fix that
// lifts the real article URL + inline thumbnail out of the feed's description
// HTML (commit "Rewrite Techmeme permalinks to source + thumbnail").
//
// Those older rows have:
//   - url  = a Techmeme permalink page (techmeme.com/260524/p16#a260524p16)
//   - no raw.thumbnail_candidate_url (the feed never exposes media:* tags)
// so cards link to the wrong page and render the gradient placeholder.
//
// This re-fetches the Techmeme feed, matches items to DB rows by external_id
// (the feed's <guid>, which we store verbatim), and patches each row in place:
//   - url -> the real article URL
//   - raw.thumbnail_candidate_url -> the inline Techmeme image
//   - clears raw.thumbnail_attempted_at so backfill_thumbs will (re)upload to S3
//
// Patching url in place (rather than re-ingesting) also prevents duplicate
// rows: post-fix ingests key dedup on the new url, which would not match the
// old permalink url and would insert a second copy.
//
// Only items still present in the feed (~most recent dozens) can be matched;
// older permalink rows age out via retention on their own.
//
// Usage:
//   node scripts/backfill-techmeme.mjs            # apply
//   node scripts/backfill-techmeme.mjs --dry-run  # show what would change

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const FEED_URL = "https://www.techmeme.com/feed.xml";
const TECHMEME_HOST = /(^|\.)techmeme\.com$/i;

// Minimal .env.local loader — same vars the app uses.
function loadEnv() {
  const file = path.join(__dirname, "..", ".env.local");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
}

function isTechmemeUrl(u) {
  try {
    return TECHMEME_HOST.test(new URL(u).hostname);
  } catch {
    return false;
  }
}

function toHttps(src) {
  if (src.startsWith("//")) return `https:${src}`;
  return src.replace(/^http:\/\//i, "https://");
}

// Mirror of extractTechmemeTarget in lib/ingest/rss.ts: prefer the anchor
// wrapping the Techmeme-hosted lead thumbnail, falling back to the first image
// anchor. Keep this in lockstep with rss.ts so the backfill resolves the same
// url/thumbnail a fresh ingest would.
function extractTechmemeTarget(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const candidates = [];
  $("a").each((_, el) => {
    const href = ($(el).attr("href") || "").trim();
    // Require an absolute http(s) target (lockstep with rss.ts): a relative
    // href would slip past isTechmemeUrl and be stored verbatim as the url.
    if (!href || !/^https?:\/\//i.test(href) || isTechmemeUrl(href)) return;
    const src = ($(el).find("img").first().attr("src") || "").trim();
    if (!src) return;
    candidates.push({ url: href, src });
  });
  if (candidates.length === 0) return null;
  const lead = candidates.find((c) => isTechmemeUrl(c.src)) ?? candidates[0];
  return { url: lead.url, thumbnail: toHttps(lead.src) };
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve the techmeme source row.
  const { data: src, error: srcErr } = await supabase
    .from("sources")
    .select("id")
    .eq("slug", "techmeme")
    .single();
  if (srcErr || !src) {
    console.error("Could not find source slug=techmeme:", srcErr?.message);
    process.exit(1);
  }

  // Parse the feed into { externalId -> { url, thumbnail } }.
  const parser = new Parser({ timeout: 15_000 });
  const feed = await parser.parseURL(FEED_URL);
  const targets = new Map();
  for (const it of feed.items ?? []) {
    const externalId = String(it.guid ?? it.link ?? "").slice(0, 400);
    if (!externalId) continue;
    // Same field precedence as rss.ts (content first), so the backfill parses
    // the same HTML the live adapter would and can't resolve a different anchor.
    const html =
      it.content || it["content:encoded"] || it.summary || it.contentSnippet || "";
    const tm = extractTechmemeTarget(String(html));
    if (tm) targets.set(externalId, tm);
  }
  console.log(`Parsed ${targets.size} resolvable items from the feed.`);

  // Pull this source's rows whose url is still a Techmeme permalink.
  const { data: rows, error: rowErr } = await supabase
    .from("items")
    .select("id, external_id, url, raw, s3_storage_id")
    .eq("source_id", src.id);
  if (rowErr) {
    console.error("Row fetch failed:", rowErr.message);
    process.exit(1);
  }

  let patched = 0;
  let unmatched = 0;
  for (const row of rows ?? []) {
    if (!isTechmemeUrl(row.url)) continue; // already fixed
    const tm = targets.get(row.external_id);
    if (!tm) {
      unmatched++;
      continue;
    }
    const raw = { ...(row.raw ?? {}) };
    raw.thumbnail_candidate_url = tm.thumbnail;
    delete raw.thumbnail_attempted_at; // let S3 backfill retry the upload
    delete raw.thumbnail_transient_count;

    console.log(
      `${DRY_RUN ? "[dry] " : ""}${row.id}\n  url:   ${row.url}\n    ->   ${tm.url}\n  thumb: ${tm.thumbnail}`,
    );
    if (!DRY_RUN) {
      const { error: uErr } = await supabase
        .from("items")
        .update({ url: tm.url, raw })
        .eq("id", row.id);
      if (uErr) {
        console.error(`  ! update failed: ${uErr.message}`);
        continue;
      }
    }
    patched++;
  }

  console.log(
    `\n${DRY_RUN ? "Would patch" : "Patched"} ${patched} row(s); ${unmatched} permalink row(s) no longer in the feed (will age out).`,
  );
  if (!DRY_RUN && patched > 0) {
    console.log("Now run scripts/backfill-thumbs.ps1 to upload the images to S3.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
