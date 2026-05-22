#!/usr/bin/env node
// Deep liveness probe for every RSS feed and crawler config in the seed.
//
// For each RSS source: parse, sample N items, verify each has a non-empty
// title + link + parseable published date. Also print the first 3 titles so a
// human can spot-check AI-relevance.
//
// For each crawler source: run cheerio with the configured selectors and
// emit the same fingerprint (first N matched titles).
//
// Exit code is non-zero when any enabled source breaks one of the assertions.

import Parser from "rss-parser";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Load ANTHROPIC_API_KEY (and anything else) from .env.local without pulling
// in a dotenv dep. Best-effort — silently no-ops if the file is missing.
async function loadDotEnvLocal() {
  try {
    const txt = await readFile(path.resolve(".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, k, vRaw] = m;
      if (k.startsWith("#") || process.env[k]) continue;
      const v = vRaw.replace(/^['"]|['"]$/g, "");
      process.env[k] = v;
    }
  } catch {
    /* no .env.local — fine */
  }
}

const TIMEOUT_MS = 15_000;
const PARALLEL = 8;
const SAMPLE_N = 5;          // items inspected per source
const PRINT_TITLES = 3;      // titles surfaced in output for human review
// Items older than this aren't ingested (matches ITEM_RETENTION_DAYS=14 default).
// A feed whose NEWEST sampled item is past this threshold contributes nothing
// to the live feed — fail it.
const STALENESS_DAYS = 60;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const RSS_SOURCES = [
  ["openai-blog",           "https://openai.com/blog/rss.xml"],
  ["anthropic-news",        "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml"],
  ["claude-blog",           "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_claude.xml"],
  ["anthropic-engineering", "https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_engineering.xml"],
  ["deepmind-blog",         "https://deepmind.google/blog/rss.xml"],
  ["google-ai-blog",        "https://blog.google/technology/ai/rss/"],
  ["microsoft-research",    "https://www.microsoft.com/en-us/research/feed/"],
  ["nvidia-blog",           "https://blogs.nvidia.com/feed/"],
  ["hf-blog",               "https://huggingface.co/blog/feed.xml"],
  ["mistral-news",          "https://raw.githubusercontent.com/0xSMW/rss-feeds/main/feeds/feed_mistral_news.xml"],
  ["together-ai",           "https://www.together.ai/blog/rss.xml"],
  ["databricks-ai",         "https://www.databricks.com/feed"],
  ["simon-willison",        "https://simonwillison.net/atom/everything/"],
  ["jack-clark",            "https://jack-clark.net/feed/"],
  ["lesswrong-ai",          "https://www.lesswrong.com/feed.xml?view=curated-rss"],
  ["techcrunch-ai",         "https://techcrunch.com/category/artificial-intelligence/feed/"],
  ["venturebeat-ai",        "https://venturebeat.com/category/ai/feed/"],
  ["mit-tech-review-ai",    "https://www.technologyreview.com/topic/artificial-intelligence/feed"],
  ["the-verge-ai",          "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml"],
  // jay-alammar, the-gradient: dropped — feed last updated >60d ago (publisher
  // dormant or moved to Substack). See seed file for the full stale list.

  ["snowflake-ai",          "https://www.snowflake.com/feed/"],
  ["replicate-blog",        "https://replicate.com/blog/rss"],
  ["bair-berkeley",         "https://bair.berkeley.edu/blog/feed.xml"],
  ["nvidia-developer",      "https://developer.nvidia.com/blog/feed/"],
  // lilian-weng, karpathy, chip-huyen, fast-ai, synced-review: dropped (stale)
  ["sebastian-raschka",     "https://magazine.sebastianraschka.com/feed"],
  ["eugene-yan",            "https://eugeneyan.com/rss/"],
  ["latent-space",          "https://www.latent.space/feed"],
  ["interconnects",         "https://www.interconnects.ai/feed"],
  ["last-week-in-ai",       "https://lastweekin.ai/feed"],
  ["ai-snake-oil",          "https://www.aisnakeoil.com/feed"],
  ["marcus-on-ai",          "https://garymarcus.substack.com/feed"],
  ["the-decoder",           "https://the-decoder.com/feed/"],
  ["weaviate-blog",         "https://weaviate.io/blog/rss.xml"],
  ["alignment-forum",       "https://www.alignmentforum.org/feed.xml?view=curated-rss"],
  ["robohub",               "https://robohub.org/feed/"],
  ["ieee-spectrum-ai",      "https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss"],
  ["ars-technica-ai",       "https://arstechnica.com/ai/feed/"],
  ["wired-ai",              "https://www.wired.com/feed/tag/ai/latest/rss"],
  ["the-register-ai",       "https://www.theregister.com/software/ai_ml/headlines.atom"],
  ["zdnet-ai",              "https://www.zdnet.com/topic/artificial-intelligence/rss.xml"],
  ["404-media",             "https://www.404media.co/rss"],
  ["axios-ai",              "https://api.axios.com/feed/tag/artificial-intelligence"],
  ["cnbc-tech",             "https://www.cnbc.com/id/19854910/device/rss/rss.html"],
  ["rest-of-world",         "https://restofworld.org/feed/latest/"],

  // Analyst newsletters
  ["platformer",            "https://platformer.news/feed"],
  ["big-technology",        "https://www.bigtechnology.com/feed"],
  ["stratechery",           "https://stratechery.com/feed/"],
  ["one-useful-thing",      "https://www.oneusefulthing.org/feed"],
  ["dont-worry-vase",       "https://thezvi.substack.com/feed"],
  ["dwarkesh-podcast",      "https://www.dwarkesh.com/feed"],
  ["astral-codex-ten",      "https://www.astralcodexten.com/feed"],
  ["the-generalist",        "https://thegeneralist.substack.com/feed"],

  // Science + AI safety
  ["quanta-magazine",       "https://www.quantamagazine.org/feed/"],
  ["80000-hours",           "https://80000hours.org/feed/"],
  ["ea-forum-ai",           "https://forum.effectivealtruism.org/feed.xml?view=ai-curated&karmaThreshold=30"],

  // Cloud-vendor ML blogs
  ["aws-ml-blog",           "https://aws.amazon.com/blogs/machine-learning/feed/"],
  ["cloudflare-ai",         "https://blog.cloudflare.com/tag/ai/rss/"],

  // 2026-05-22 additions — sources tldr.tech cites regularly.
  // General tech journalism (AI-adjacent):
  ["thenextweb",            "https://thenextweb.com/feed"],
  ["9to5google",            "https://9to5google.com/feed/"],
  ["techmeme",              "https://www.techmeme.com/feed.xml"],
  ["pragmatic-engineer",    "https://newsletter.pragmaticengineer.com/feed"],
  // AI-focused research / engineering blogs:
  ["pytorch-blog",          "https://pytorch.org/blog/feed.xml"],
  // apple-ml dropped — rss.xml ships unescaped `&` in titles, breaking
  // rss-parser. Add a crawler stub if first-party Apple ML coverage matters.
  ["vercel-blog",           "https://vercel.com/blog/feed.xml"],
  ["spotify-engineering",   "https://engineering.atspotify.com/feed"],
  ["meta-engineering",      "https://engineering.fb.com/feed/"],
  // AI commentary / analyst:
  ["tom-tunguz",            "https://tomtunguz.com/index.xml"],
  ["searchengineland",      "https://searchengineland.com/feed"],
  ["testingcatalog",        "https://www.testingcatalog.com/rss/"],
  // corememory dropped: too broad (covers aerospace history etc.) for an
  // AI-only feed despite Vance frequently covering the industry.
  ["algorithmic-bridge",    "https://www.thealgorithmicbridge.com/feed"],
  ["understanding-ai",      "https://www.understandingai.org/feed"],
];

const CRAWLER_SOURCES = [
  {
    slug: "anthropic-news-crawled",
    base_url: "https://www.anthropic.com/news",
    item_selector: 'a[class*="PublicationList"][class*="listItem"]',
    title_selector: 'span[class*="title"]',
    url_prefix: "https://www.anthropic.com",
  },
  {
    slug: "anthropic-research-crawled",
    base_url: "https://www.anthropic.com/research",
    item_selector: 'a[class*="PublicationList"][class*="listItem"]',
    title_selector: 'span[class*="title"]',
    url_prefix: "https://www.anthropic.com",
  },
  {
    slug: "cerebras-crawled",
    base_url: "https://www.cerebras.ai/blog",
    item_selector: 'a.flex.md\\:flex-col.to-md\\:gap-6',
    title_selector: 'h3, h2, [class*="title"], [class*="heading"]',
    url_prefix: "https://www.cerebras.ai",
  },
];

// Relevance scoring is delegated to Claude Haiku — model names change every
// week (Seedance, Recraft V4, Kimi K2.6, Mythos, ...) so any static keyword
// list goes stale immediately. The verifier batches every source's sampled
// titles into a single Haiku request after probing finishes.
//
// Opt out with SKIP_RELEVANCE=1 if you're offline or want a cheap dry-run.

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const RELEVANCE_SYSTEM_PROMPT = `You are auditing RSS sources for an AI news aggregator.

For each source the user gives you, you'll see a handful of sampled article titles. Decide what fraction are "AI-related". Count something as AI-related if it concerns any of: foundation models, LLMs, ML research, AI agents, AI products/tools, AI infrastructure (GPUs, vector DBs, training compute), AI labs/vendors, AI policy/safety, robotics, computer vision, speech/voice AI, generative media (image/video/audio), or AI-driven applications.

Reply with ONE JSON object — no prose, no markdown fences — keyed by source slug. For each source:
  {
    "score": <integer 0-100, percent of sampled titles that are AI-related>,
    "off_topic": [<verbatim copies of any titles that are NOT AI-related>]
  }

Example:
{"openai-blog": {"score": 100, "off_topic": []}, "zdnet-ai": {"score": 40, "off_topic": ["Samsung Frame Pro TV deal"]}}`;

async function scoreRelevanceWithClaude(slugToTitles) {
  if (process.env.SKIP_RELEVANCE === "1" || !process.env.ANTHROPIC_API_KEY) {
    return new Map();
  }
  const entries = Object.entries(slugToTitles).filter(([, ts]) => ts.length > 0);
  if (entries.length === 0) return new Map();

  const userMessage = entries
    .map(([slug, titles]) => {
      const lines = titles.map((t, i) => `  ${i + 1}. ${t.replace(/\s+/g, " ").slice(0, 200)}`).join("\n");
      return `${slug}:\n${lines}`;
    })
    .join("\n\n");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let raw;
  try {
    const resp = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: RELEVANCE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMessage }],
    });
    const block = resp.content.find((b) => b.type === "text");
    raw = block?.text ?? "";
  } catch (e) {
    console.error(`[relevance] claude call failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    return new Map();
  }

  // Be defensive: Claude sometimes wraps JSON in prose despite the instruction.
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    console.error(`[relevance] no JSON object in response (got ${raw.slice(0, 200)})`);
    return new Map();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
  } catch (e) {
    console.error(`[relevance] JSON parse failed: ${(e instanceof Error ? e.message : String(e))}`);
    return new Map();
  }

  const out = new Map();
  for (const [slug, v] of Object.entries(parsed)) {
    if (typeof v !== "object" || v === null) continue;
    const score = Number((v).score);
    const offTopic = Array.isArray((v).off_topic) ? (v).off_topic : [];
    if (Number.isFinite(score)) {
      out.set(slug, { score: Math.max(0, Math.min(100, Math.round(score))), offTopic });
    }
  }
  return out;
}

const parser = new Parser({
  timeout: TIMEOUT_MS,
  headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, */*" },
});

function isParseableDate(s) {
  if (!s) return false;
  const t = Date.parse(s);
  return !Number.isNaN(t) && t > 0;
}

function rssString(val, fallback = "") {
  if (typeof val === "string") return val;
  if (val && typeof val === "object" && "_" in val) return String(val._ ?? fallback);
  return fallback;
}

async function probeRss(slug, url) {
  let feed;
  try {
    feed = await parser.parseURL(url);
  } catch (e) {
    return { slug, status: "FAIL", note: (e.message || String(e)).slice(0, 120) };
  }

  const items = feed.items ?? [];
  if (items.length === 0) {
    return { slug, status: "EMPTY", note: "feed has 0 items" };
  }

  const sample = items.slice(0, SAMPLE_N);
  let badTitle = 0, badLink = 0, badDate = 0;
  const sampledTitles = [];
  const sampleTimes = [];
  for (const it of sample) {
    const title = (it.title || "").trim();
    const link = (rssString(it.link) || rssString(it.guid) || "").trim();
    const dateStr = it.isoDate || it.pubDate || null;
    if (!title) badTitle++;
    if (!link) badLink++;
    if (!isParseableDate(dateStr)) badDate++;
    else sampleTimes.push(Date.parse(dateStr));
    if (title) sampledTitles.push(title);
  }

  const newestMs = sampleTimes.length ? Math.max(...sampleTimes) : null;
  const ageDays = newestMs !== null ? (Date.now() - newestMs) / 86_400_000 : null;
  const isStale = ageDays !== null && ageDays > STALENESS_DAYS;

  const titlesForDisplay = sampledTitles.slice(0, PRINT_TITLES);

  const problems = [];
  if (badTitle > 0) problems.push(`${badTitle}/${sample.length} missing title`);
  if (badLink > 0)  problems.push(`${badLink}/${sample.length} missing link`);
  if (badDate > 0)  problems.push(`${badDate}/${sample.length} unparseable date`);
  if (isStale)      problems.push(`newest item is ${Math.round(ageDays)}d old (> ${STALENESS_DAYS}d threshold)`);

  let status = "OK";
  if (badTitle === sample.length || badLink === sample.length) status = "FAIL";
  else if (isStale) status = "STALE";
  else if (badTitle > 0 || badLink > 0 || badDate >= sample.length / 2) status = "WARN";

  return {
    slug,
    status,
    total: items.length,
    sampled: sample.length,
    newestAgeDays: ageDays === null ? null : Math.round(ageDays),
    sampledTitles,             // full list for the batched Claude call
    titles: titlesForDisplay,  // truncated list for the report
    problems,
  };
}

async function probeCrawler(c) {
  let html;
  try {
    const resp = await fetch(c.base_url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
    });
    if (!resp.ok) return { slug: c.slug, status: "FAIL", note: `HTTP ${resp.status}` };
    html = await resp.text();
  } catch (e) {
    return { slug: c.slug, status: "FAIL", note: (e.message || String(e)).slice(0, 120) };
  }

  const $ = cheerio.load(html);
  const matched = $(c.item_selector);
  if (matched.length === 0) {
    return { slug: c.slug, status: "EMPTY", note: `selector matched 0 nodes` };
  }

  const sample = matched.slice(0, SAMPLE_N);
  let badTitle = 0, badLink = 0;
  const titles = [];
  sample.each((_, el) => {
    const $el = $(el);
    const title = (c.title_selector
      ? $el.find(c.title_selector).first().text()
      : $el.text()
    ).trim();
    const href = $el.is("a") ? $el.attr("href") : $el.find("a").first().attr("href");
    if (!title) badTitle++;
    if (!href) badLink++;
    if (title) titles.push(title);
  });

  const problems = [];
  if (badTitle > 0) problems.push(`${badTitle}/${sample.length} missing title`);
  if (badLink > 0) problems.push(`${badLink}/${sample.length} missing link`);

  let status = "OK";
  if (badTitle === sample.length || badLink === sample.length) status = "FAIL";
  else if (badTitle > 0 || badLink > 0) status = "WARN";

  return {
    slug: c.slug,
    status,
    total: matched.length,
    sampled: sample.length,
    sampledTitles: titles,
    titles: titles.slice(0, PRINT_TITLES),
    problems,
  };
}

async function runPool(jobs, concurrency, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < jobs.length) {
        const me = i++;
        out[me] = await fn(jobs[me]);
      }
    }),
  );
  return out;
}

function fmtRow(kind, r) {
  const tag =
    r.status === "OK"    ? "OK   " :
    r.status === "WARN"  ? "WARN " :
    r.status === "STALE" ? "STALE" :
    r.status === "EMPTY" ? "EMPTY" :
                           "FAIL ";
  const sus = r.aiSuspect ? "  [off-topic?]" : "";
  const probs = r.problems?.length ? `  problems=[${r.problems.join("; ")}]` : "";
  const note = r.note ? `  :: ${r.note}` : "";
  const age = r.newestAgeDays !== null && r.newestAgeDays !== undefined
    ? `  newest=${r.newestAgeDays}d`
    : "";
  const aiCol = r.aiScore !== undefined ? `  ai=${r.aiScore}%` : "";
  const counts = r.total !== undefined
    ? `  total=${r.total} sampled=${r.sampled}${age}${aiCol}`
    : "";
  return `${kind}  ${tag}  ${r.slug.padEnd(28)}${counts}${probs}${note}${sus}`;
}

async function main() {
  await loadDotEnvLocal();
  const useClaude = process.env.SKIP_RELEVANCE !== "1" && !!process.env.ANTHROPIC_API_KEY;

  console.error(
    `# Deep probe: ${RSS_SOURCES.length} RSS + ${CRAWLER_SOURCES.length} crawlers ` +
    `(sample=${SAMPLE_N}/source, parallel=${PARALLEL}, relevance=${useClaude ? "claude-haiku" : "skipped"})\n`
  );

  const rssR = await runPool(RSS_SOURCES, PARALLEL, ([slug, url]) => probeRss(slug, url));
  const crawlR = await runPool(CRAWLER_SOURCES, PARALLEL, (c) => probeCrawler(c));
  const all = [...rssR, ...crawlR];

  // One batched Claude call across every source's sampled titles. Static
  // keyword lists go stale every time a new model is announced (Seedance,
  // Kimi K2.6, Mythos...) so the semantic call is worth ~$0.001/run.
  if (useClaude) {
    const slugToTitles = Object.fromEntries(
      all
        .filter((r) => Array.isArray(r.sampledTitles) && r.sampledTitles.length > 0)
        .map((r) => [r.slug, r.sampledTitles]),
    );
    const scores = await scoreRelevanceWithClaude(slugToTitles);
    for (const r of all) {
      const s = scores.get(r.slug);
      if (!s) continue;
      r.aiScore = s.score;
      r.offTopicTitles = s.offTopic;
      // Flag sources where <30% of sampled titles read as AI-related.
      // Doesn't fail the run — informational signal for human review.
      if (s.score < 30 && r.sampledTitles.length >= 3) r.aiSuspect = true;
    }
  }

  for (const r of rssR) {
    console.log(fmtRow("rss  ", r));
    for (const t of r.titles ?? []) console.log(`           · ${t.slice(0, 100)}`);
  }
  for (const r of crawlR) {
    console.log(fmtRow("crawl", r));
    for (const t of r.titles ?? []) console.log(`           · ${t.slice(0, 100)}`);
  }

  const tally = { OK: 0, WARN: 0, STALE: 0, EMPTY: 0, FAIL: 0 };
  for (const r of all) tally[r.status] = (tally[r.status] || 0) + 1;
  console.error(`\n# Summary: OK=${tally.OK}  WARN=${tally.WARN}  STALE=${tally.STALE}  EMPTY=${tally.EMPTY}  FAIL=${tally.FAIL}`);

  const aiSuspect = all.filter((r) => r.aiSuspect);
  if (aiSuspect.length) {
    console.error(`\n# Possibly off-topic feeds (Claude scored < 30% AI-relevance — review by hand):`);
    for (const r of aiSuspect) {
      const off = r.offTopicTitles?.length ? `  off-topic: ${r.offTopicTitles.slice(0, 3).join(" | ").slice(0, 160)}` : "";
      console.error(`  - ${r.slug}  (score=${r.aiScore}%)${off}`);
    }
  }

  const broken = all.filter((r) => r.status === "FAIL" || r.status === "EMPTY" || r.status === "STALE");
  if (broken.length) {
    console.error(`\n# Broken sources:`);
    for (const r of broken) console.error(`  - ${r.slug}: ${r.status} ${r.note ?? r.problems?.join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("verify-sources fatal:", e);
  process.exit(1);
});
