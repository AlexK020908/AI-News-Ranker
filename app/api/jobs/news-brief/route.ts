import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedJob } from "@/lib/job-auth";
import { chatText, BRIEF_MODEL, llmConfigured } from "@/lib/llm/chat";
import { extractJsonBlock } from "@/lib/utils";
import { DIGEST_MIN_IMPORTANCE } from "@/lib/anthropic/scoring";
import { etDayWindow, BRIEF_HOUR_ET } from "@/lib/schedule";
import {
  NEWS_BRIEF_SYSTEM_PROMPT,
  buildNewsBriefUserMessage,
  renderNewsBriefMarkdown,
  isNewsBriefSections,
  type NewsItemInput,
  type NewsCitation,
} from "@/lib/anthropic/news-brief-prompt";
import type { Category } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Rolling window the brief summarises. 24h ending now means the 8am-ET morning
// run covers the full previous day.
const WINDOW_HOURS = 24;
const TRENDING_OVERFETCH = 200; // trending_items has no time filter — over-fetch, post-filter.
const MAX_ITEMS_FOR_PROMPT = 40;

interface TrendingItemRow {
  id: string;
  source_id: string;
  url: string;
  title: string;
  summary: string | null;
  category: Category | null;
  importance: number | null;
  duplicate_count: number;
  paper_tldr: string | null;
  published_at: string | null;
  ingested_at: string;
}

interface SourceRow {
  id: string;
  name: string;
}

// "What's going on in AI Space" — the ranked news brief. Generated once per
// ET day in the morning (force=1 bypasses the gate for manual runs). Latest row
// for surface='news' drives the /brief page and the daily email's lead section.
export async function GET(req: NextRequest) {
  if (!isAuthorizedJob(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!llmConfigured()) {
    return Response.json({ error: "no LLM provider configured" }, { status: 500 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  const win = etDayWindow();

  // Gate 1: don't generate before the morning send hour (ET).
  if (!force && !win.isAfterBriefHour) {
    return Response.json({ ok: true, skipped: true, reason: `before ${BRIEF_HOUR_ET}:00 ET`, hour_et: win.hourET });
  }

  // Gate 2: once per ET day. Fail SAFE — on a read error, skip rather than
  // risk re-spending on Sonnet every tick.
  if (!force) {
    const { data: today, error: todayErr } = await supabase
      .from("briefs")
      .select("id")
      .eq("surface", "news")
      .gte("generated_at", win.etMidnightUtc)
      .limit(1)
      .maybeSingle();
    if (todayErr) {
      return Response.json({ ok: true, skipped: true, reason: `brief lookup failed: ${todayErr.message}` });
    }
    if (today) {
      return Response.json({ ok: true, skipped: true, reason: "brief already generated today (ET)" });
    }
  }

  const { data: trending, error: tErr } = await supabase.rpc("trending_items", {
    min_importance: DIGEST_MIN_IMPORTANCE,
    cat: null,
    source_kinds: null,
    max_rows: TRENDING_OVERFETCH,
  });
  if (tErr) {
    return Response.json({ error: `trending_items: ${tErr.message}` }, { status: 500 });
  }

  const nowMs = Date.now();
  const sinceMs = nowMs - WINDOW_HOURS * 3600 * 1000;
  const rows = ((trending ?? []) as TrendingItemRow[])
    .filter((r) => {
      const stamp = r.published_at ?? r.ingested_at;
      const t = Date.parse(stamp);
      return Number.isFinite(t) && t >= sinceMs && t <= nowMs && r.title?.length > 0;
    })
    .slice(0, MAX_ITEMS_FOR_PROMPT);

  if (rows.length === 0) {
    return Response.json({ ok: true, skipped: true, reason: "no items above importance threshold in 24h window" });
  }

  // Resolve source names (trending_items doesn't join sources).
  const sourceIds = Array.from(new Set(rows.map((r) => r.source_id).filter(Boolean)));
  let sourceById = new Map<string, string>();
  if (sourceIds.length > 0) {
    const { data: srcs } = await supabase.from("sources").select("id, name").in("id", sourceIds);
    sourceById = new Map(((srcs ?? []) as SourceRow[]).map((s) => [s.id, s.name]));
  }

  // Number the items [1..N] and keep a parallel lookup so we can build the
  // citation map from whatever [n] the model cites.
  const items: NewsItemInput[] = rows.map((r, idx) => ({
    n: idx + 1,
    title: r.title,
    summary: r.summary,
    category: r.category,
    importance: r.importance,
    duplicate_count: r.duplicate_count,
    source_name: sourceById.get(r.source_id) ?? "unknown",
    paper_tldr: r.paper_tldr,
  }));
  const byN = new Map(items.map((it) => [it.n, { url: rows[it.n - 1].url, label: it.source_name }]));

  const period = { start: new Date(sinceMs).toISOString(), end: new Date(nowMs).toISOString() };

  let sections;
  try {
    const text = await chatText({
      system: NEWS_BRIEF_SYSTEM_PROMPT,
      user: buildNewsBriefUserMessage(items, period),
      model: BRIEF_MODEL,
      maxTokens: 2000,
    });
    const block = extractJsonBlock(text);
    const parsed = block ? JSON.parse(block) : null;
    if (!isNewsBriefSections(parsed) || parsed.topics.length === 0) {
      return Response.json({ error: "model returned malformed or empty brief" }, { status: 502 });
    }
    sections = parsed;
  } catch (e) {
    return Response.json({ error: `brief generation: ${(e as Error).message}` }, { status: 502 });
  }

  // Build [n] → source link map from the cites the model actually used.
  const citations: Record<string, NewsCitation> = {};
  for (const t of sections.topics) {
    const src = byN.get(t.cite);
    if (src) citations[t.cite] = { label: src.label, posts: [{ url: src.url, handle: src.label }] };
  }

  const markdown = renderNewsBriefMarkdown(sections, period);

  const { error: insErr } = await supabase.from("briefs").insert({
    surface: "news",
    period_start: period.start,
    period_end: period.end,
    markdown,
    sections,
    citations,
    model: BRIEF_MODEL,
    item_count: items.length,
  });
  if (insErr) return Response.json({ error: insErr.message }, { status: 500 });

  return Response.json({
    ok: true,
    generated: true,
    topics: sections.topics.length,
    candidates: rows.length,
  });
}

export const POST = GET;
