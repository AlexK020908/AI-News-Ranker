import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedJob } from "@/lib/job-auth";
import {
  clusterByEmbedding,
  cosineSimilarityWithNorm,
  memberHash,
  vectorNorm,
  type Cluster,
} from "@/lib/topics/cluster";
import { labelCluster, slugify } from "@/lib/topics/label";
import { buildLinkEdges } from "@/lib/topics/links";
import { runPool } from "@/lib/utils";
import { HIGH_IMPACT_MEMBER_IMPORTANCE } from "@/lib/anthropic/scoring";
import { twitterSourceIds, pgInList } from "@/lib/twitter-sources";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const WINDOW_HOURS = 96;
// 0.76 balances same-story grouping (0.80+) with related-topic grouping
// (0.72-0.80). Tightened from 0.72 which was collapsing loosely related
// stories (e.g. different funding rounds) into one cluster.
const CLUSTER_THRESHOLD = 0.76;
// Lower threshold for a second pass restricted to paper items. arXiv
// preprints embed each other tightly when they share subject matter
// (diffusion ↔ diffusion, RAG ↔ RAG) at 0.62-0.70. The standard 0.72
// threshold leaves most thematic groups uncomputed, so papers show up
// as 50 individual cards instead of "5 diffusion papers" / "8 agent
// papers" rollups. 0.62 is the cosine floor below which AI papers
// cease to share a subject area at all.
const PAPER_CLUSTER_THRESHOLD = 0.62;
// Default cluster size floor. arXiv papers are unique research and rarely
// receive 3+ pieces of corroborating coverage, so we use a lower floor for
// paper-majority clusters — see PAPER_MIN_CLUSTER_SIZE below.
//
// 2026-05-22: lowered from 3 → 2. The homepage row layout starves the
// long-tail categories (news, release, discussion, announcement) of
// clusters because most blog posts only have one outlet covering them,
// and 3-member coverage is rare outside of frontier-lab announcements.
// 2 still gates out random embedding noise pairs (you need both items to
// independently land in the same 0.72 cosine bucket) but lets multi-
// outlet news stories form clusters. Single-source items still go through
// notable_solo_items.
const MIN_CLUSTER_SIZE = 2;
const PAPER_MIN_CLUSTER_SIZE = 2;
const TOPIC_MATCH_THRESHOLD = 0.85;
const STALE_HOURS = 168;
const LABEL_CONCURRENCY = 3;
// Only match against topics recent enough to plausibly still exist after this
// run's prune — bounds the centroid fetch to O(hours) rows instead of all-time.
const MATCH_WINDOW_HOURS = STALE_HOURS * 2;
const MAX_EXISTING_TOPICS = 500;

// Trending score for a topic. Mirrors the per-item formula but operates on the
// cluster aggregate so big-and-important topics outrank big-but-noisy ones.
//
// member_count is cross-source corroboration — N independent reputable outlets
// covering the same story, the gold-standard anti-manipulation signal (see
// lib/stories.ts). We weight it via member_count^CORROBORATION_EXP so it pulls
// harder than the per-item importance (an LLM-derived number we want to lean on
// LESS). Raised from 0.5 (plain sqrt) to 0.6 so a 4-source "notable" story
// edges out a solo "breaking"-ish item whose high score is one model's opinion.
const CORROBORATION_EXP = 0.6;
function topicTrending(c: Cluster, ageHours: number): number {
  const impact = c.avg_importance * Math.pow(c.member_count, CORROBORATION_EXP);
  return impact / Math.pow(Math.max(0, ageHours) + 2, 1.1);
}

interface ItemRow {
  id: string;
  title: string;
  summary: string | null;
  importance: number | null;
  category: string | null;
  published_at: string | null;
  ingested_at: string;
  // url + raw drive deterministic paper↔repo / same-arXiv-ID linking
  // (buildLinkEdges). They aren't used by the embedding math.
  url: string;
  raw: Record<string, unknown> | null;
  // pgvector columns come back from the Supabase JS client as their text
  // serialization ('[0.01,0.02,...]'), not as a JS array. parseVector() below
  // accepts either form so the cluster math works regardless.
  embedding: number[] | string | null;
}

interface ExistingTopic {
  id: string;
  slug: string;
  label: string;
  summary: string | null;
  member_count: number;
  // Always a parsed array (or null) by the time this type is consumed;
  // the raw row is normalized through parseVector() at load time.
  centroid: number[] | null;
  member_hash: string | null;
}

function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v.length > 0 ? (v as number[]) : null;
  if (typeof v === "string" && v.length > 1) {
    try {
      const arr = JSON.parse(v);
      return Array.isArray(arr) && arr.length > 0 ? (arr as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedJob(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  const started = Date.now();
  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();
  // Tweets are clustered separately by /api/jobs/cluster-tweets into x_topics —
  // keep them out of the article topics entirely so an X post can never land in
  // a feed cluster (the /x section is isolated by design). Fail CLOSED: if the
  // source lookup errors we abort rather than cluster everything (which would
  // leak tweets into the feed).
  let excludeTwitter: string | null;
  try {
    excludeTwitter = pgInList(await twitterSourceIds(supabase));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  let itemsQuery = supabase
    .from("items")
    .select("id, title, summary, importance, category, published_at, ingested_at, url, raw, embedding")
    .not("enriched_at", "is", null)
    .is("duplicate_of", null)
    .not("embedding", "is", null)
    .gte("enriched_at", since)
    .limit(3000);
  if (excludeTwitter) itemsQuery = itemsQuery.not("source_id", "in", excludeTwitter);
  const { data: itemRows, error: iErr } = await itemsQuery;

  if (iErr) return Response.json({ error: iErr.message }, { status: 500 });
  const items = (itemRows ?? []) as ItemRow[];
  const categoryById = new Map(items.map((it) => [it.id, it.category] as const));

  const clusterInputs = items
    .map((it) => {
      const emb = parseVector(it.embedding);
      if (!emb) return null;
      return { id: it.id, embedding: emb, importance: it.importance };
    })
    .filter((x): x is { id: string; embedding: number[]; importance: number | null } => x !== null);

  // Deterministic edges: a paper and the repo that implements it, or the same
  // arXiv ID ingested from two sources. These often don't clear the cosine
  // threshold, so we force-union them. Built over the same item set so any
  // referenced id is guaranteed present in clusterInputs.
  const mustLink = buildLinkEdges(
    items.map((it) => ({ id: it.id, url: it.url, raw: it.raw })),
  );

  // Pass 1 — tight clustering across ALL items at 0.72. Catches same-story
  // multi-outlet coverage regardless of category. mustLink seeds the
  // paper↔repo / same-arXiv-ID edges before the similarity pass.
  const rawClusters = clusterByEmbedding(clusterInputs, {
    threshold: CLUSTER_THRESHOLD,
    min_size: PAPER_MIN_CLUSTER_SIZE,
    mustLink,
  });

  // Pass 2 — loose THEMATIC clustering over papers only, at 0.62. Catches
  // subject-area groupings (all diffusion papers, all RAG papers, etc.).
  // Restricted to papers because the looser threshold over mixed categories
  // would collapse unrelated news stories.
  const paperInputs = clusterInputs.filter(
    (x) => categoryById.get(x.id) === "paper",
  );
  const paperThematicClusters = clusterByEmbedding(paperInputs, {
    threshold: PAPER_CLUSTER_THRESHOLD,
    min_size: 3, // require 3+ to mark something as a real theme
  });

  // Merge: prefer the tighter pass-1 cluster when an item appears in both.
  // A paper that's part of a same-story pass-1 group (rare but possible)
  // shouldn't get re-bucketed into the broader theme.
  const claimedByPass1 = new Set<string>();
  for (const c of rawClusters) {
    for (const id of c.member_ids) claimedByPass1.add(id);
  }
  const thematicSurvivors = paperThematicClusters
    .map((c) => ({
      ...c,
      member_ids: c.member_ids.filter((id) => !claimedByPass1.has(id)),
    }))
    .filter((c) => c.member_ids.length >= 3)
    .map((c) => ({ ...c, member_count: c.member_ids.length }));

  // Per-category gate on pass-1: papers ship at 2 members, everything else
  // needs MIN_CLUSTER_SIZE. Pass-2 thematic clusters already required 3+
  // above and bypass this gate.
  const pass1Filtered = rawClusters.filter((c) => {
    if (c.member_count >= MIN_CLUSTER_SIZE) return true;
    const counts = new Map<string, number>();
    for (const id of c.member_ids) {
      const cat = categoryById.get(id) ?? "other";
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    let topCat = "other";
    let topN = 0;
    for (const [cat, n] of counts) {
      if (n > topN) { topCat = cat; topN = n; }
    }
    return topCat === "paper" && c.member_count >= PAPER_MIN_CLUSTER_SIZE;
  });
  const clusters = [...pass1Filtered, ...thematicSurvivors];

  if (clusters.length === 0) {
    await pruneStaleTopics(supabase);
    return Response.json({
      ok: true,
      items: items.length,
      clusters: 0,
      durationMs: Date.now() - started,
    });
  }

  const itemById = new Map(items.map((it) => [it.id, it] as const));

  const matchSince = new Date(
    Date.now() - MATCH_WINDOW_HOURS * 3600 * 1000,
  ).toISOString();
  const { data: existingRows, error: eErr } = await supabase
    .from("topics")
    .select("id, slug, label, summary, member_count, centroid, member_hash")
    .gte("last_updated_at", matchSince)
    .order("last_updated_at", { ascending: false })
    .limit(MAX_EXISTING_TOPICS);
  if (eErr) return Response.json({ error: eErr.message }, { status: 500 });
  // Parse the centroid text serialization into actual arrays once, here, so
  // downstream code (bestTopicMatch + cosineSimilarityWithNorm) doesn't have
  // to re-handle the pgvector → string quirk.
  const existing: ExistingTopic[] = (existingRows ?? []).map((t) => ({
    ...(t as ExistingTopic),
    centroid: parseVector((t as ExistingTopic).centroid),
  }));
  // Precompute centroid norms once — bestTopicMatch runs per cluster and each
  // cosineSimilarity call would otherwise re-norm the same topic vectors.
  const existingNorms = existing.map((t) =>
    Array.isArray(t.centroid) && t.centroid.length > 0 ? vectorNorm(t.centroid) : 0,
  );

  let labeled = 0;
  let reused = 0;
  let skipped = 0;
  const touchedIds: string[] = [];

  await runPool(clusters, LABEL_CONCURRENCY, async (cluster) => {
    const hash = memberHash(cluster.member_ids);
    const match = bestTopicMatch(existing, existingNorms, cluster.centroid);

    const mostRecent = cluster.member_ids
      .map((id) => itemById.get(id))
      .filter((x): x is ItemRow => Boolean(x))
      .map((it) => new Date(it.published_at ?? it.ingested_at).getTime())
      .reduce((a, b) => Math.max(a, b), 0);
    const ageHours = mostRecent > 0 ? (Date.now() - mostRecent) / 3_600_000 : 0;
    const trending = topicTrending(cluster, ageHours);

    // Fast path: membership and centroid both match — only the ranking/stats
    // need refreshing. Skip centroid/member_hash/members rewrite so Realtime
    // subscribers don't see an update for a topic that hasn't actually changed.
    if (match && match.member_hash === hash && match.label) {
      const { error } = await supabase
        .from("topics")
        .update({
          member_count: cluster.member_count,
          avg_importance: round2(cluster.avg_importance),
          max_importance: cluster.max_importance,
          trending_score: round2(trending),
          last_updated_at: new Date().toISOString(),
        })
        .eq("id", match.id);
      if (error) {
        console.error("topic stats update failed:", error.message);
        return;
      }
      reused++;
      touchedIds.push(match.id);
      return;
    }

    const topicId: string | null = match?.id ?? null;
    let label: string;
    let summary: string | null;
    let slug: string;

    const canReuseLabel =
      match && match.label && isTightEnoughToReuse(cluster);
    if (canReuseLabel && match) {
      const memberCountDelta = Math.abs(cluster.member_count - (match.member_count ?? 0));
      const hasHighImpactMember = cluster.member_ids.some(
        (id) => (itemById.get(id)?.importance ?? 0) >= HIGH_IMPACT_MEMBER_IMPORTANCE,
      );
      if (memberCountDelta >= 2 || hasHighImpactMember) {
        const labelResult = await labelClusterSafe(cluster, itemById);
        if (labelResult) {
          label = labelResult.label;
          summary = labelResult.summary || null;
          labeled++;
        } else {
          label = match.label;
          summary = match.summary;
          reused++;
        }
      } else {
        label = match.label;
        summary = match.summary;
        reused++;
      }
      slug = match.slug;
    } else {
      const labelResult = await labelClusterSafe(cluster, itemById);
      if (!labelResult) {
        skipped++;
        return;
      }
      labeled++;
      label = labelResult.label;
      summary = labelResult.summary || null;
      slug = await uniqueSlug(supabase, slugify(label), topicId);
    }

    const topicRow = {
      slug,
      label,
      summary,
      member_count: cluster.member_count,
      avg_importance: round2(cluster.avg_importance),
      max_importance: cluster.max_importance,
      trending_score: round2(trending),
      centroid: cluster.centroid,
      member_hash: hash,
      last_updated_at: new Date().toISOString(),
    };

    let persistedId: string;
    if (topicId) {
      const { error } = await supabase.from("topics").update(topicRow).eq("id", topicId);
      if (error) {
        console.error("topic update failed:", error.message);
        return;
      }
      persistedId = topicId;
    } else {
      const { data, error } = await supabase
        .from("topics")
        .insert(topicRow)
        .select("id")
        .single();
      if (error || !data) {
        console.error("topic insert failed:", error?.message);
        return;
      }
      persistedId = data.id;
    }

    // Delete-then-insert is not atomic — a realtime subscriber could briefly
    // see an empty member list. Acceptable: the next render already picks up
    // the old topics row's stats, and this runs hourly.
    await supabase.from("topic_members").delete().eq("topic_id", persistedId);
    const memberRows = cluster.member_ids.map((id) => ({
      topic_id: persistedId,
      item_id: id,
    }));
    if (memberRows.length > 0) {
      const { error: mErr } = await supabase.from("topic_members").insert(memberRows);
      if (mErr) console.error("member insert failed:", mErr.message);
    }

    touchedIds.push(persistedId);
  });

  const pruned = await pruneStaleTopics(supabase);

  return Response.json({
    ok: true,
    items: items.length,
    clusters: clusters.length,
    labeled,
    reused,
    skipped,
    pruned,
    durationMs: Date.now() - started,
  });
}

export const POST = GET;

function bestTopicMatch(
  existing: readonly ExistingTopic[],
  existingNorms: readonly number[],
  centroid: readonly number[],
): ExistingTopic | null {
  const cNorm = vectorNorm(centroid);
  if (cNorm === 0) return null;
  let best: ExistingTopic | null = null;
  let bestSim = TOPIC_MATCH_THRESHOLD;
  for (let i = 0; i < existing.length; i++) {
    const t = existing[i];
    const tNorm = existingNorms[i];
    if (!t.centroid || tNorm === 0) continue;
    const sim = cosineSimilarityWithNorm(centroid, cNorm, t.centroid, tNorm);
    if (sim >= bestSim) {
      bestSim = sim;
      best = t;
    }
  }
  return best;
}

function isTightEnoughToReuse(c: Cluster): boolean {
  return c.avg_similarity >= 0.75;
}

async function labelClusterSafe(
  cluster: Cluster,
  itemById: ReadonlyMap<string, ItemRow>,
): Promise<{ label: string; summary: string } | null> {
  const titles: string[] = [];
  const summaries: string[] = [];
  const ordered = cluster.member_ids
    .map((id) => itemById.get(id))
    .filter((x): x is ItemRow => Boolean(x))
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
  for (const it of ordered.slice(0, 12)) {
    titles.push(it.title);
    summaries.push(it.summary ?? "");
  }
  try {
    return await labelCluster({ titles, summaries });
  } catch (e) {
    console.error("labelCluster failed:", (e as Error).message);
    return null;
  }
}

async function uniqueSlug(
  supabase: SupabaseClient,
  base: string,
  selfTopicId: string | null,
): Promise<string> {
  const fallback = base || `topic-${Math.random().toString(36).slice(2, 8)}`;
  for (let i = 0; i < 6; i++) {
    const candidate = i === 0 ? fallback : `${fallback}-${i + 1}`;
    const { data } = await supabase
      .from("topics")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data || data.id === selfTopicId) return candidate;
  }
  return `${fallback}-${Date.now().toString(36).slice(-4)}`;
}

async function pruneStaleTopics(supabase: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from("topics")
    .delete()
    .lt("last_updated_at", cutoff)
    .select("id");
  if (error) {
    console.error("pruneStaleTopics:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
