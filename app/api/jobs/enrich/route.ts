import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { enrichItem } from "@/lib/anthropic/enrich";
import { embedText } from "@/lib/anthropic/embed";
import {
  extractArxivId,
  fetchPaperSignals,
  shouldFetchPaperSignals,
} from "@/lib/anthropic/semantic-scholar";
import { isAuthorizedJob } from "@/lib/job-auth";
import { runPool } from "@/lib/utils";
import { getStorage } from "@/lib/storage/s3";
import { fetchPageOgImage, githubRepoOgImage } from "@/lib/ingest/og-image";
import { DEFAULT_REGION, type SourceKind } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const BATCH_LIMIT = 30;
const CONCURRENCY = 3;

// Semantic dedup — only collapse true twins, not "related coverage". The
// clusterer (at threshold 0.72) wants related-but-distinct items to remain as
// separate canonicals; 0.93 keeps near-paraphrases together but preserves
// stories that differ in angle or detail, so they can populate a story panel
// instead of being silently absorbed.
const DEDUP_THRESHOLD = 0.93;
const DEDUP_WINDOW_HOURS = 72;

interface UnenrichedRow {
  id: string;
  source_id: string;
  title: string;
  url: string;
  author: string | null;
  content: string | null;
  published_at: string | null;
  region: string;
  raw: Record<string, unknown> | null;
  external_id: string;
  s3_storage_id: string | null;
  source: { slug: string; name: string; kind: SourceKind; reputation_weight: number };
}

interface ThumbnailResolution {
  s3Key: string | null;
  derivedCandidateUrl: string | null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedJob(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit") ?? BATCH_LIMIT)));

  // Thumbnail-only backfill mode. Runs the same fallback pipeline against
  // already-enriched rows that never got a thumbnail (S3 was unset at the
  // time, or the source never carried an image). No Claude/embedding work.
  if (searchParams.get("backfill_thumbs") === "1") {
    return await runThumbnailBackfill(limit);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("items")
      .select(
        "id, source_id, title, url, author, content, published_at, region, raw, external_id, s3_storage_id, source:sources!inner(slug, name, kind, reputation_weight)",
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
        // Run Claude enrichment and thumbnail upload concurrently — they're
        // independent network-bound work. Thumbnail upload is non-fatal: a
        // rejection just leaves s3_storage_id unset for this item.
        const thumbnailPromise = resolveThumbnailFor(r);
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
        } catch (e) {
          // Log so partial Voyage failures (rate-limit, bad key) surface in the
          // server logs instead of silently producing un-embedded items.
          console.warn(`[enrich] embed failed for ${r.id}: ${(e as Error).message.slice(0, 200)}`);
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

        const thumb = await thumbnailPromise;
        if (thumb.s3Key) update.s3_storage_id = thumb.s3Key;
        if (thumb.derivedCandidateUrl) {
          // Persist the URL we just derived from og:image / GitHub OG into raw
          // so the frontend thumb_url fallback works even if S3 isn't configured
          // and so a future re-run doesn't refetch the article HTML.
          update.raw = {
            ...(r.raw ?? {}),
            thumbnail_candidate_url: thumb.derivedCandidateUrl,
          };
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

async function runThumbnailBackfill(limit: number): Promise<Response> {
  try {
    const supabase = createSupabaseServiceClient();
    // Target enriched-but-thumbnailless rows. We pull rows missing s3_storage_id;
    // resolveThumbnailFor() will also be a no-op for rows that already have a
    // candidate URL in raw when S3 is unset, so this is safe to run repeatedly.
    const { data, error } = await supabase
      .from("items")
      .select(
        "id, source_id, title, url, author, content, published_at, region, raw, external_id, s3_storage_id, source:sources!inner(slug, name, kind, reputation_weight)",
      )
      .not("enriched_at", "is", null)
      .is("s3_storage_id", null)
      .is("duplicate_of", null)
      .order("ingested_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as UnenrichedRow[];

    let updated = 0;
    let skipped = 0;

    await runPool(rows, CONCURRENCY, async (r) => {
      const thumb = await resolveThumbnailFor(r);
      if (!thumb.s3Key && !thumb.derivedCandidateUrl) {
        skipped++;
        return;
      }
      const patch: Record<string, unknown> = {};
      if (thumb.s3Key) patch.s3_storage_id = thumb.s3Key;
      if (thumb.derivedCandidateUrl) {
        patch.raw = {
          ...(r.raw ?? {}),
          thumbnail_candidate_url: thumb.derivedCandidateUrl,
        };
      }
      const { error: uErr } = await supabase.from("items").update(patch).eq("id", r.id);
      if (uErr) {
        skipped++;
        console.warn(`[enrich/backfill] update ${r.id} failed: ${uErr.message}`);
        return;
      }
      updated++;
    });

    return Response.json({ ok: true, mode: "backfill_thumbs", batch: rows.length, updated, skipped });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

function rawThumbnailCandidate(raw: Record<string, unknown> | null): string | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>).thumbnail_candidate_url;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Skip sources where fetching the page for og:image is wasteful or hostile:
//   - arxiv abstract pages return the arXiv logo, not a paper-specific image
//   - HN item pages have no useful card
//   - HuggingFace model pages have og:image, but they're generic site cards
function shouldDeriveOgImageFor(r: UnenrichedRow): boolean {
  const host = safeHostname(r.url);
  if (!host) return false;
  if (host.endsWith("arxiv.org")) return false;
  if (host.endsWith("news.ycombinator.com")) return false;
  if (host === "huggingface.co" || host.endsWith(".huggingface.co")) return false;
  return true;
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function deriveCandidate(r: UnenrichedRow): Promise<string | null> {
  // Cheap & deterministic first: GitHub repos have a stable OG endpoint.
  const gh = githubRepoOgImage(r.url);
  if (gh) return gh;
  if (!shouldDeriveOgImageFor(r)) return null;
  return await fetchPageOgImage(r.url);
}

async function resolveThumbnailFor(r: UnenrichedRow): Promise<ThumbnailResolution> {
  // Already uploaded — nothing to do.
  if (r.s3_storage_id) return { s3Key: null, derivedCandidateUrl: null };

  const existing = rawThumbnailCandidate(r.raw);
  let candidate = existing;
  let derived: string | null = null;
  if (!candidate) {
    derived = await deriveCandidate(r);
    candidate = derived;
  }
  if (!candidate) return { s3Key: null, derivedCandidateUrl: null };

  const storage = getStorage();
  if (!storage.enabled) {
    // No bucket — but we still want the derived URL persisted so the frontend
    // thumb_url fallback can use it. (If `existing` was already in raw, no
    // need to rewrite it.)
    return { s3Key: null, derivedCandidateUrl: derived };
  }
  try {
    const uploaded = await storage.uploadThumbnail(candidate, {
      region: r.region || DEFAULT_REGION,
      sourceSlug: r.source.slug,
      externalId: r.external_id,
    });
    return { s3Key: uploaded?.key ?? null, derivedCandidateUrl: derived };
  } catch {
    return { s3Key: null, derivedCandidateUrl: derived };
  }
}
