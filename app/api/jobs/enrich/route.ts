import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { enrichItem } from "@/lib/anthropic/enrich";
import { combineImportance } from "@/lib/anthropic/scoring";
import { embedText } from "@/lib/anthropic/embed";
import {
  extractArxivId,
  fetchPaperSignals,
  shouldFetchPaperSignals,
} from "@/lib/anthropic/semantic-scholar";
import { isAuthorizedJob } from "@/lib/job-auth";
import { runPool } from "@/lib/utils";
import { getBlockedHosts, getStorage } from "@/lib/storage/s3";
import { fetchPageOgImage, githubRepoOgImage } from "@/lib/ingest/og-image";
import { DEFAULT_REGION, type Category, type SourceKind } from "@/lib/types";

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
  engagement_score: number | null;
  source: { slug: string; name: string; kind: SourceKind; reputation_weight: number };
}

interface ThumbnailResolution {
  s3Key: string | null;
  derivedCandidateUrl: string | null;
  // True when we ran the full pipeline (derive + upload, where applicable)
  // and ended up without an s3Key — used to mark the row as exhausted so
  // backfill runs don't keep retrying broken URLs or 404'd CDN paths.
  attempted: boolean;
  // When set, replaces raw.thumbnail_transient_count on the row. Each real
  // transient failure increments this; once it hits MAX_TRANSIENT_ATTEMPTS,
  // resolveThumbnailFor also sets attempted=true so the row drops out of
  // backfill. "blocked" (breaker skip) does not bump the counter — nothing
  // was actually tried.
  transientCount?: number;
}

// Cap for how many real transient failures a single row can rack up before
// we give up. 3 is enough to ride out a flaky CDN or a brief S3 hiccup, and
// keeps the backfill from looping forever on a row whose source URL is
// permanently broken in a way that masquerades as transient (TLS error,
// slow loris, connection reset).
const MAX_TRANSIENT_ATTEMPTS = 3;

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

  // Caveman backfill — re-run enrichItem on already-enriched paper rows
  // that have no caveman_summary. Only the caveman column is overwritten;
  // summary/category/tags/importance are left intact so the row's existing
  // signal is preserved. Triggered when the caveman field was added after
  // a row was already enriched, or when Claude returned an empty caveman
  // on first pass.
  if (searchParams.get("backfill_caveman") === "1") {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
    }
    return await runCavemanBackfill(limit);
  }

  // Importance backfill — re-run enrichItem on enriched rows that pre-date the
  // sub-scores migration. Recomputes sub_scores + importance using the new
  // multi-axis combiner. Everything else on the row stays as-is. Dead-lettered
  // via raw.importance_backfilled_at so a single bad row doesn't cycle.
  if (searchParams.get("backfill_importance") === "1") {
    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
    }
    return await runImportanceBackfill(limit);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("items")
      .select(
        "id, source_id, title, url, author, content, published_at, region, raw, external_id, s3_storage_id, engagement_score, source:sources!inner(slug, name, kind, reputation_weight)",
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
          sub_scores: result.subScores,
          enriched_at: new Date().toISOString(),
          enrich_error: null,
        };
        // Importance is computed AFTER the optional Semantic Scholar block
        // below so the citation bump (paper-only) can factor in. Assigned to
        // `update.importance` at the end of this block, before the DB write.
        // Plain-English caveman explanation — only persisted for papers.
        // Claude is instructed to omit it for non-paper items, but the
        // belt-and-suspenders gate here keeps a stray response from
        // populating the column on a "release" or "news" row.
        if (result.category === "paper" && result.caveman_summary) {
          update.caveman_summary = result.caveman_summary;
        }
        if (embedding) {
          update.embedding = embedding;
          const { data: matches } = await supabase.rpc("similar_recent_items", {
            query_embedding: embedding,
            match_threshold: DEDUP_THRESHOLD,
            match_count: 1,
            since_hours: DEDUP_WINDOW_HOURS,
            // Dedup only within the item's own surface: tweets dedup against
            // tweets, articles against articles. Cross-surface matches would
            // hide an article behind a tweet (or vice versa), breaking the /x
            // isolation guarantee.
            restrict_twitter: r.source.kind === "twitter",
          });
          const match = (matches as { id: string }[] | null)?.[0];
          if (match && match.id !== r.id) update.duplicate_of = match.id;
        }

        const thumb = await thumbnailPromise;
        if (thumb.s3Key) update.s3_storage_id = thumb.s3Key;
        const rawPatch = buildRawPatch(r.raw, thumb);
        if (rawPatch) update.raw = rawPatch;

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

        // Now that paper citations may have been populated, combine the
        // sub-scores + row signals into a final 0-100 importance. Done last so
        // every signal that's going to be available IS available — running it
        // earlier would miss the citation bump for fresh arXiv rows.
        update.importance = combineImportance({
          subScores: result.subScores,
          signals: {
            engagementScore: r.engagement_score,
            reputationWeight: r.source.reputation_weight,
            influentialCitations:
              typeof update.paper_influential_citations === "number"
                ? update.paper_influential_citations
                : null,
            isPaper: result.category === "paper",
          },
        });

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
    // Skip rows whose candidate URL is on a currently-blocked host. Without
    // this, the same 50 rate-limited rows fill every batch and the script
    // stalls — even though there are non-blocked rows further back that
    // could be processed right now.
    const blocked = getBlockedHosts();

    // Target enriched-but-thumbnailless rows that we haven't already tried.
    // The `raw->>thumbnail_attempted_at` filter is what stops 404s and
    // oversized URLs from cycling forever — once we've tried and failed,
    // the row is excluded from future backfill batches.
    let query = supabase
      .from("items")
      .select(
        "id, source_id, title, url, author, content, published_at, region, raw, external_id, s3_storage_id, engagement_score, source:sources!inner(slug, name, kind, reputation_weight)",
      )
      .not("enriched_at", "is", null)
      .is("s3_storage_id", null)
      .is("duplicate_of", null)
      .filter("raw->>thumbnail_attempted_at", "is", null);

    for (const { host } of blocked) {
      // Exclude rows whose candidate URL contains this host. Substring match
      // via not-ilike — fine because blocked hosts are full FQDNs unlikely
      // to appear inside another URL's path.
      query = query.not("raw->>thumbnail_candidate_url", "ilike", `%${host}%`);
    }

    const { data, error } = await query
      .order("ingested_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as UnenrichedRow[];

    let updated = 0;
    let skipped = 0;

    await runPool(rows, CONCURRENCY, async (r) => {
      const thumb = await resolveThumbnailFor(r);
      const patch: Record<string, unknown> = {};
      if (thumb.s3Key) patch.s3_storage_id = thumb.s3Key;
      const rawPatch = buildRawPatch(r.raw, thumb);
      if (rawPatch) patch.raw = rawPatch;
      if (Object.keys(patch).length === 0) {
        skipped++;
        return;
      }
      const { error: uErr } = await supabase.from("items").update(patch).eq("id", r.id);
      if (uErr) {
        skipped++;
        console.warn(`[enrich/backfill] update ${r.id} failed: ${uErr.message}`);
        return;
      }
      updated++;
    });

    // Re-snapshot after processing — fresh 429s during the run can add new
    // entries the caller will want to see.
    const blockedAfter = getBlockedHosts();
    return Response.json({
      ok: true,
      mode: "backfill_thumbs",
      batch: rows.length,
      updated,
      skipped,
      blocked: blockedAfter.length > 0 ? blockedAfter : undefined,
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

async function runCavemanBackfill(limit: number): Promise<Response> {
  try {
    const supabase = createSupabaseServiceClient();
    // Target: enriched paper rows with no caveman, that we haven't already
    // tried to backfill. raw.caveman_backfilled_at acts as a dead-letter
    // marker — without it, Claude refusals (or truly un-caveman-able papers)
    // would cycle through every batch forever.
    const { data, error } = await supabase
      .from("items")
      .select(
        "id, source_id, title, url, author, content, published_at, region, raw, external_id, s3_storage_id, engagement_score, source:sources!inner(slug, name, kind, reputation_weight)",
      )
      .eq("category", "paper")
      .is("caveman_summary", null)
      .not("enriched_at", "is", null)
      .is("duplicate_of", null)
      .filter("raw->>caveman_backfilled_at", "is", null)
      .order("ingested_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as UnenrichedRow[];

    let updated = 0;
    let empty = 0;
    let failed = 0;

    await runPool(rows, CONCURRENCY, async (r) => {
      const nowIso = new Date().toISOString();
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

        const patch: Record<string, unknown> = {
          raw: { ...(r.raw ?? {}), caveman_backfilled_at: nowIso },
        };
        if (result.category === "paper" && result.caveman_summary) {
          patch.caveman_summary = result.caveman_summary;
          updated++;
        } else {
          // Either Claude declined to caveman-ify it, or the row no longer
          // classifies as a paper on re-enrich. Mark it so we don't retry.
          empty++;
        }

        const { error: uErr } = await supabase.from("items").update(patch).eq("id", r.id);
        if (uErr) throw new Error(uErr.message);
      } catch (e) {
        failed++;
        console.warn(`[enrich/caveman] ${r.id} failed: ${(e as Error).message.slice(0, 200)}`);
      }
    });

    return Response.json({
      ok: true,
      mode: "backfill_caveman",
      batch: rows.length,
      updated,
      empty,
      failed,
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

async function runImportanceBackfill(limit: number): Promise<Response> {
  try {
    const supabase = createSupabaseServiceClient();
    // Target: enriched rows with no sub_scores (pre-migration) that we
    // haven't already tried. raw.importance_backfilled_at is the dead-letter
    // marker — without it, a row whose enrichItem keeps throwing would
    // cycle through every batch forever.
    const { data, error } = await supabase
      .from("items")
      .select(
        "id, source_id, title, url, author, content, published_at, region, raw, external_id, s3_storage_id, engagement_score, category, paper_influential_citations, source:sources!inner(slug, name, kind, reputation_weight)",
      )
      .not("enriched_at", "is", null)
      .is("sub_scores", null)
      .is("duplicate_of", null)
      .filter("raw->>importance_backfilled_at", "is", null)
      .order("ingested_at", { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    type BackfillRow = UnenrichedRow & {
      category: Category | null;
      paper_influential_citations: number | null;
    };
    const rows = (data ?? []) as unknown as BackfillRow[];

    let updated = 0;
    let failed = 0;

    await runPool(rows, CONCURRENCY, async (r) => {
      const nowIso = new Date().toISOString();
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

        // Use the freshly classified category from the re-enrichment to gate
        // the citation bump — a row that no longer classifies as a paper
        // shouldn't get a paper-only bonus, and vice versa.
        const importance = combineImportance({
          subScores: result.subScores,
          signals: {
            engagementScore: r.engagement_score,
            reputationWeight: r.source.reputation_weight,
            influentialCitations: r.paper_influential_citations,
            isPaper: result.category === "paper",
          },
        });

        const patch: Record<string, unknown> = {
          sub_scores: result.subScores,
          importance,
          raw: { ...(r.raw ?? {}), importance_backfilled_at: nowIso },
        };

        const { error: uErr } = await supabase.from("items").update(patch).eq("id", r.id);
        if (uErr) throw new Error(uErr.message);
        updated++;
      } catch (e) {
        failed++;
        console.warn(`[enrich/importance] ${r.id} failed: ${(e as Error).message.slice(0, 200)}`);
      }
    });

    return Response.json({
      ok: true,
      mode: "backfill_importance",
      batch: rows.length,
      updated,
      failed,
    });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// Combine the row's existing raw with derived URL, retry counter, and/or
// dead-letter marker. Returns null when nothing needs to be written.
function buildRawPatch(
  existingRaw: Record<string, unknown> | null,
  thumb: ThumbnailResolution,
): Record<string, unknown> | null {
  if (
    !thumb.derivedCandidateUrl &&
    !thumb.attempted &&
    thumb.transientCount === undefined
  ) {
    return null;
  }
  const patch: Record<string, unknown> = { ...(existingRaw ?? {}) };
  if (thumb.derivedCandidateUrl) {
    patch.thumbnail_candidate_url = thumb.derivedCandidateUrl;
  }
  if (thumb.transientCount !== undefined) {
    patch.thumbnail_transient_count = thumb.transientCount;
  }
  if (thumb.attempted) {
    patch.thumbnail_attempted_at = new Date().toISOString();
  }
  return patch;
}

function rawThumbnailCandidate(raw: Record<string, unknown> | null): string | null {
  if (!raw || typeof raw !== "object") return null;
  const v = (raw as Record<string, unknown>).thumbnail_candidate_url;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function rawTransientCount(raw: Record<string, unknown> | null): number {
  if (!raw || typeof raw !== "object") return 0;
  const v = (raw as Record<string, unknown>).thumbnail_transient_count;
  return typeof v === "number" && v >= 0 ? Math.floor(v) : 0;
}

// Skip sources where fetching the page for og:image is wasteful or hostile:
//   - arxiv abstract pages return the arXiv logo, not a paper-specific image
//   - HN item pages have no useful card
//   - HuggingFace model/dataset pages share a generic site og:image —
//     but /blog/* posts have real per-article images, so allow those.
function shouldDeriveOgImageFor(r: UnenrichedRow): boolean {
  const host = safeHostname(r.url);
  if (!host) return false;
  if (host.endsWith("arxiv.org")) return false;
  if (host.endsWith("news.ycombinator.com")) return false;
  if (host === "huggingface.co" || host.endsWith(".huggingface.co")) {
    // Blog posts have per-article og:image; everything else (model, dataset,
    // space, user pages) shares the generic HuggingFace site card.
    try {
      const path = new URL(r.url).pathname;
      return path.startsWith("/blog/");
    } catch {
      return false;
    }
  }
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
  if (r.s3_storage_id) {
    return { s3Key: null, derivedCandidateUrl: null, attempted: false };
  }

  const existing = rawThumbnailCandidate(r.raw);
  let candidate = existing;
  let derived: string | null = null;
  if (!candidate) {
    derived = await deriveCandidate(r);
    candidate = derived;
  }
  if (!candidate) {
    // We tried to derive and got nothing — mark attempted so we don't
    // re-scrape the article HTML next backfill.
    return { s3Key: null, derivedCandidateUrl: null, attempted: true };
  }

  const storage = getStorage();
  if (!storage.enabled) {
    // No bucket — store the derived URL (if any) so the frontend's thumb_url
    // fallback can use it, but don't mark attempted: if S3 gets enabled later
    // we want this row to be retried.
    return { s3Key: null, derivedCandidateUrl: derived, attempted: false };
  }
  try {
    const result = await storage.uploadThumbnail(candidate, {
      region: r.region || DEFAULT_REGION,
      sourceSlug: r.source.slug,
      externalId: r.external_id,
    });
    if (result.outcome === "uploaded" && result.thumbnail) {
      return {
        s3Key: result.thumbnail.key,
        derivedCandidateUrl: derived,
        attempted: false,
      };
    }
    if (result.outcome === "permanent") {
      return { s3Key: null, derivedCandidateUrl: derived, attempted: true };
    }
    if (result.outcome === "blocked") {
      // Breaker tripped mid-round (after the SQL filter snapshot). No fetch
      // happened, so don't bump the retry counter — this row will be
      // SQL-excluded next round until the window clears.
      return { s3Key: null, derivedCandidateUrl: derived, attempted: false };
    }
    // "transient": real failure (429-after-retry, 5xx, network, S3 put fail).
    // Bump the counter and dead-letter once it crosses the cap.
    const nextCount = rawTransientCount(r.raw) + 1;
    const exhausted = nextCount >= MAX_TRANSIENT_ATTEMPTS;
    return {
      s3Key: null,
      derivedCandidateUrl: derived,
      attempted: exhausted,
      transientCount: nextCount,
    };
  } catch {
    // Unexpected exception in the storage layer — count it as transient so
    // a pathological case still hits the cap eventually.
    const nextCount = rawTransientCount(r.raw) + 1;
    const exhausted = nextCount >= MAX_TRANSIENT_ATTEMPTS;
    return {
      s3Key: null,
      derivedCandidateUrl: derived,
      attempted: exhausted,
      transientCount: nextCount,
    };
  }
}
