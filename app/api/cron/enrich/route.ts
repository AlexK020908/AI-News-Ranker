import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { enrichItem } from "@/lib/anthropic/enrich";
import { embedText } from "@/lib/anthropic/embed";
import {
  extractArxivId,
  fetchPaperSignals,
  shouldFetchPaperSignals,
} from "@/lib/anthropic/semantic-scholar";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runPool } from "@/lib/utils";
import type { SourceKind } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BATCH_LIMIT = 30;
const CONCURRENCY = 3;

// Semantic dedup — tune as needed. voyage-3 title+summary for the same story
// typically clusters in [0.88, 0.95]; below 0.88 the false-positive rate climbs fast.
const DEDUP_THRESHOLD = 0.88;
const DEDUP_WINDOW_HOURS = 72;

interface UnenrichedRow {
  id: string;
  source_id: string;
  title: string;
  url: string;
  author: string | null;
  content: string | null;
  published_at: string | null;
  source: { name: string; kind: SourceKind; reputation_weight: number };
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") ?? BATCH_LIMIT)));

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("items")
      .select(
        "id, source_id, title, url, author, content, published_at, source:sources!inner(name, kind, reputation_weight)",
      )
      .is("enriched_at", null)
      .is("enrich_error", null)
      .order("ingested_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as UnenrichedRow[];

    let enriched = 0;
    let failed = 0;

    await runPool(rows, CONCURRENCY, async (r) => {
      try {
        const result = await enrichItem({
          sourceName: r.source.name,
          sourceKind: r.source.kind,
          title: r.title,
          url: r.url,
          author: r.author,
          content: r.content,
          publishedAt: r.published_at,
        });

        let embedding: number[] | null = null;
        try {
          embedding = await embedText([r.title, result.summary].filter(Boolean).join("\n"));
        } catch {
          embedding = null;
        }

        const update: Record<string, unknown> = {
          summary: result.summary,
          category: result.category,
          tags: result.tags,
          importance: result.importance,
          enriched_at: new Date().toISOString(),
          enrich_error: null,
        };
        if (embedding) {
          update.embedding = embedding;
          const { data: matches } = await supabase.rpc("similar_recent_items", {
            query_embedding: embedding,
            match_threshold: DEDUP_THRESHOLD,
            match_count: 1,
            since_hours: DEDUP_WINDOW_HOURS,
          });
          const match = (matches as { id: string }[] | null)?.[0];
          if (match && match.id !== r.id) update.duplicate_of = match.id;
        }

        // Semantic Scholar enrichment for arXiv papers (non-fatal).
        const arxivId = extractArxivId(r.url);
        if (arxivId && shouldFetchPaperSignals(r.published_at)) {
          try {
            const signals = await fetchPaperSignals(arxivId);
            if (signals) {
              update.paper_citations = signals.citations;
              update.paper_influential_citations = signals.influential_citations;
              if (signals.tldr) update.paper_tldr = signals.tldr;
            }
          } catch {
            // Ignore — S2 is optional signal.
          }
        }

        const { error: uErr } = await supabase.from("items").update(update).eq("id", r.id);
        if (uErr) throw new Error(uErr.message);
        if (update.duplicate_of) {
          await supabase.rpc("bump_duplicate_count", {
            canonical_id: update.duplicate_of as string,
            dup_weight: r.source.reputation_weight ?? 1.0,
          });
        }
        enriched++;
      } catch (e) {
        failed++;
        await supabase
          .from("items")
          .update({ enrich_error: (e as Error).message.slice(0, 500) })
          .eq("id", r.id);
      }
    });

    return Response.json({ ok: true, batch: rows.length, enriched, failed });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const POST = GET;
