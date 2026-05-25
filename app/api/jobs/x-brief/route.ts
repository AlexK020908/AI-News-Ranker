import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedJob } from "@/lib/job-auth";
import { getAnthropic } from "@/lib/anthropic/client";
import { extractJsonBlock } from "@/lib/utils";
import { twitterSourceIds } from "@/lib/twitter-sources";
import {
  X_BRIEF_MODEL,
  X_BRIEF_SYSTEM_PROMPT,
  buildXBriefUserMessage,
  renderXBriefMarkdown,
  isXBriefSections,
  type XClusterInput,
  type XTweetInput,
} from "@/lib/anthropic/x-brief-prompt";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const WINDOW_HOURS = 24;
// Regenerate at most this often — a brief is a synthesis, not a live view, and
// each generation is a Sonnet call. ?force=1 bypasses for manual runs.
const INTERVAL_HOURS = 3;
const MAX_TWEETS = 40;
const MAX_CLUSTERS = 20;

interface TweetRow {
  title: string;
  author: string | null;
  importance: number | null;
  engagement_score: number | null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedJob(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const force = new URL(req.url).searchParams.get("force") === "1";

  // Cadence guard: skip if a brief was generated within INTERVAL_HOURS.
  if (!force) {
    const { data: latest } = await supabase
      .from("briefs")
      .select("generated_at")
      .eq("surface", "x")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest && Date.now() - Date.parse(latest.generated_at) < INTERVAL_HOURS * 3600 * 1000) {
      return Response.json({ ok: true, skipped: true, reason: "recent brief exists" });
    }
  }

  // Fail closed on source-lookup error (same rationale as the cluster jobs):
  // an empty id list would silently produce a contentless brief.
  let twitterIds: string[];
  try {
    twitterIds = await twitterSourceIds(supabase);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  if (twitterIds.length === 0) {
    return Response.json({ ok: true, skipped: true, reason: "no twitter sources" });
  }

  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  const [tweetsRes, clustersRes] = await Promise.all([
    supabase
      .from("items")
      .select("title, author, importance, engagement_score")
      .in("source_id", twitterIds)
      .not("enriched_at", "is", null)
      .is("duplicate_of", null)
      .gte("ingested_at", since)
      .order("engagement_score", { ascending: false })
      .limit(MAX_TWEETS),
    supabase
      .from("x_topics")
      .select("label, summary, member_count")
      .order("trending_score", { ascending: false })
      .limit(MAX_CLUSTERS),
  ]);

  if (tweetsRes.error) return Response.json({ error: tweetsRes.error.message }, { status: 500 });

  const tweets: XTweetInput[] = ((tweetsRes.data ?? []) as TweetRow[]).map((t) => ({
    handle: t.author ?? "@unknown",
    text: t.title,
    importance: t.importance,
    engagement: Number(t.engagement_score) || 0,
  }));

  if (tweets.length === 0) {
    return Response.json({ ok: true, skipped: true, reason: "no recent enriched tweets" });
  }

  const clusters: XClusterInput[] = clustersRes.error
    ? (console.warn("x-brief clusters load:", clustersRes.error.message), [])
    : ((clustersRes.data ?? []) as XClusterInput[]);

  const period = { start: since, end: new Date().toISOString() };
  const userMsg = buildXBriefUserMessage(clusters, tweets, period);

  let markdown: string;
  let sections: unknown;
  try {
    const anthropic = getAnthropic();
    const resp = await anthropic.messages.create({
      model: X_BRIEF_MODEL,
      max_tokens: 1200,
      system: [
        { type: "text", text: X_BRIEF_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMsg }],
    });
    const textBlock = resp.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return Response.json({ error: "no text in model response" }, { status: 502 });
    }
    const block = extractJsonBlock(textBlock.text);
    sections = block ? JSON.parse(block) : null;
    if (!isXBriefSections(sections)) {
      return Response.json({ error: "model returned malformed sections" }, { status: 502 });
    }
    markdown = renderXBriefMarkdown(sections, period, tweets.length);
  } catch (e) {
    return Response.json({ error: `brief generation: ${(e as Error).message}` }, { status: 502 });
  }

  const { error: insErr } = await supabase.from("briefs").insert({
    surface: "x",
    period_start: period.start,
    period_end: period.end,
    markdown,
    sections,
    model: X_BRIEF_MODEL,
    item_count: tweets.length,
  });
  if (insErr) return Response.json({ error: insErr.message }, { status: 500 });

  return Response.json({
    ok: true,
    generated: true,
    posts: tweets.length,
    clusters: clusters.length,
  });
}

export const POST = GET;
