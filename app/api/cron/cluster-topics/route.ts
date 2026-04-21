import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import {
  clusterByEmbedding,
  cosineSimilarityWithNorm,
  memberHash,
  vectorNorm,
  type Cluster,
} from "@/lib/topics/cluster";
import { labelCluster, slugify } from "@/lib/topics/label";
import { runPool } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const WINDOW_HOURS = 48;
const CLUSTER_THRESHOLD = 0.78;
const MIN_CLUSTER_SIZE = 3;
const TOPIC_MATCH_THRESHOLD = 0.85;
const STALE_HOURS = 72;
const LABEL_CONCURRENCY = 3;
// Only match against topics recent enough to plausibly still exist after this
// run's prune — bounds the centroid fetch to O(hours) rows instead of all-time.
const MATCH_WINDOW_HOURS = STALE_HOURS * 2;
const MAX_EXISTING_TOPICS = 500;

// Trending score for a topic. Mirrors the per-item formula but operates on the
// cluster aggregate so big-and-important topics outrank big-but-noisy ones.
function topicTrending(c: Cluster, ageHours: number): number {
  const impact = c.avg_importance * Math.sqrt(c.member_count);
  return impact / Math.pow(Math.max(0, ageHours) + 2, 1.1);
}

interface ItemRow {
  id: string;
  title: string;
  summary: string | null;
  importance: number | null;
  published_at: string | null;
  ingested_at: string;
  embedding: number[] | null;
}

interface ExistingTopic {
  id: string;
  slug: string;
  label: string;
  summary: string | null;
  centroid: number[] | null;
  member_hash: string | null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
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
  const { data: itemRows, error: iErr } = await supabase
    .from("items")
    .select("id, title, summary, importance, published_at, ingested_at, embedding")
    .not("enriched_at", "is", null)
    .is("duplicate_of", null)
    .not("embedding", "is", null)
    .gte("enriched_at", since)
    .limit(3000);

  if (iErr) return Response.json({ error: iErr.message }, { status: 500 });
  const items = (itemRows ?? []) as ItemRow[];

  const clusterInputs = items
    .filter((it) => Array.isArray(it.embedding) && it.embedding.length > 0)
    .map((it) => ({
      id: it.id,
      embedding: it.embedding as number[],
      importance: it.importance,
    }));

  const clusters = clusterByEmbedding(clusterInputs, {
    threshold: CLUSTER_THRESHOLD,
    min_size: MIN_CLUSTER_SIZE,
  });

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
    .select("id, slug, label, summary, centroid, member_hash")
    .gte("last_updated_at", matchSince)
    .order("last_updated_at", { ascending: false })
    .limit(MAX_EXISTING_TOPICS);
  if (eErr) return Response.json({ error: eErr.message }, { status: 500 });
  const existing = (existingRows ?? []) as ExistingTopic[];
  // Precompute centroid norms once — bestTopicMatch runs per cluster and each
  // cosineSimilarity call would otherwise re-norm the same topic vectors.
  const existingNorms = existing.map((t) =>
    t.centroid && t.centroid.length > 0 ? vectorNorm(t.centroid) : 0,
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

    let topicId: string | null = match?.id ?? null;
    let label: string;
    let summary: string | null;
    let slug: string;

    const canReuseLabel =
      match && match.label && isTightEnoughToReuse(cluster);
    if (canReuseLabel && match) {
      label = match.label;
      summary = match.summary;
      slug = match.slug;
      reused++;
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
