import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedJob } from "@/lib/job-auth";
import { rerankTopics, type RerankCandidate } from "@/lib/anthropic/rerank-prompt";
import { llmConfigured } from "@/lib/llm/chat";
import { runPool } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// How many of the top topics (by trending_score) to put through the listwise
// re-rank. This is the front page — beyond ~40 the order barely shows, and a
// bigger list dilutes the model's comparative attention. One Claude call.
const RERANK_TOP_N = 40;
const UPDATE_CONCURRENCY = 6;

interface TopicRow {
  id: string;
  label: string;
  summary: string | null;
  member_count: number;
  max_importance: number | null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedJob(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!llmConfigured()) {
    return Response.json({ error: "no LLM provider configured" }, { status: 500 });
  }

  const started = Date.now();
  const supabase = createSupabaseServiceClient();

  // Candidate set: the current top topics by the cluster job's trending_score.
  // Recency is already baked into trending_score, so this is the right pool to
  // re-order; the rerank refines importance ordering within it.
  const { data: topicData, error } = await supabase
    .from("topics")
    .select("id, label, summary, member_count, max_importance")
    .gte("member_count", 2)
    .order("trending_score", { ascending: false })
    .limit(RERANK_TOP_N);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const topics = (topicData ?? []) as TopicRow[];
  if (topics.length < 2) {
    return Response.json({ ok: true, ranked: 0, reason: "not enough topics" });
  }

  // Candidates are passed in trending order (the query above), which is
  // recency-weighted — the prompt tells the model to treat list position as a
  // freshness-aware prior, so no separate per-story age lookup is needed.
  const candidates: RerankCandidate[] = topics.map((t, i) => ({
    ref: i + 1,
    label: t.label,
    summary: t.summary,
    memberCount: t.member_count,
    maxImportance: t.max_importance,
  }));

  const order = await rerankTopics(candidates);
  if (!order) {
    // Call/parse failed — leave existing ranks untouched. They age out via the
    // freshness gate in the loader, so a missed pass degrades to trending order.
    return Response.json({ ok: false, ranked: 0, reason: "rerank unavailable" });
  }

  // ref (1-based, = index into `topics`) → topic id.
  const nowIso = new Date().toISOString();
  const updates = order.map((ref, idx) => ({
    id: topics[ref - 1].id,
    rank: idx + 1,
  }));

  let written = 0;
  let failed = 0;
  // Partial-column updates only (topics has NOT NULL columns, so a bulk upsert
  // would try to insert incomplete rows). Per-row update, bounded concurrency.
  await runPool(updates, UPDATE_CONCURRENCY, async (u) => {
    const { error: uErr } = await supabase
      .from("topics")
      .update({ rerank_rank: u.rank, reranked_at: nowIso })
      .eq("id", u.id);
    if (uErr) {
      failed++;
      console.error("rerank update failed:", uErr.message);
    } else {
      written++;
    }
  });

  // Clear ranks NOT written this pass (reranked_at < nowIso): topics that
  // dropped out of the top-N, plus any row whose update above failed and so
  // still carries a previous pass's rank. Without this, a stale rank stays
  // "fresh" (reranked_at within RERANK_FRESH_HOURS) and keeps leading the page,
  // and a partial write would interleave two passes' rankings. Rows written
  // this pass have reranked_at == nowIso and are excluded; never-ranked rows
  // are null and don't match `<`.
  const { error: clearErr } = await supabase
    .from("topics")
    .update({ rerank_rank: null, reranked_at: null })
    .lt("reranked_at", nowIso);
  if (clearErr) console.error("rerank stale-clear failed:", clearErr.message);

  return Response.json({
    ok: true,
    candidates: candidates.length,
    written,
    failed,
    cleared: clearErr ? undefined : true,
    durationMs: Date.now() - started,
  });
}

export const POST = GET;
