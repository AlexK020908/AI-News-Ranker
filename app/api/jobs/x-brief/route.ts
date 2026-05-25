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
  type XSourceInput,
  type XCitation,
} from "@/lib/anthropic/x-brief-prompt";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const WINDOW_HOURS = 24;
// Regenerate at most this often — a brief is a synthesis, not a live view, and
// each generation is a Sonnet call. ?force=1 bypasses for manual runs.
const INTERVAL_HOURS = 3;
const MAX_CLUSTERS = 12;        // cite-able clusters
const MAX_SOLO = 15;            // standout individual posts
const MEMBERS_PER_CLUSTER = 6;  // member posts carried into a cluster citation

interface ClusterRow {
  id: string;
  label: string;
  summary: string | null;
  member_count: number;
}
interface MemberRow {
  topic_id: string;
  item_id: string;
  items: { url: string; author: string | null } | null;
}
interface TweetRow {
  id: string;
  url: string;
  title: string;
  author: string | null;
  engagement_score: number | null;
}

// author is stored as "@handle" by the adapter; strip for a clean display handle.
function cleanHandle(author: string | null): string {
  return (author ?? "").replace(/^@/, "") || "x";
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

  // Cadence guard: skip if a brief was generated within INTERVAL_HOURS. Fail
  // SAFE — on a read error or unparseable timestamp, skip (don't regenerate),
  // so a transient blip or bad row can't make us re-spend on Sonnet every tick.
  if (!force) {
    const { data: latest, error: latestErr } = await supabase
      .from("briefs")
      .select("generated_at")
      .eq("surface", "x")
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) {
      return Response.json({ ok: true, skipped: true, reason: `brief lookup failed: ${latestErr.message}` });
    }
    if (latest) {
      const ts = Date.parse(latest.generated_at);
      if (!Number.isFinite(ts) || Date.now() - ts < INTERVAL_HOURS * 3600 * 1000) {
        return Response.json({ ok: true, skipped: true, reason: "recent brief exists" });
      }
    }
  }

  // Fail closed on source-lookup error (same rationale as the cluster jobs).
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

  // Top clusters + top individual posts in parallel.
  const [clustersRes, tweetsRes] = await Promise.all([
    supabase
      .from("x_topics")
      .select("id, label, summary, member_count")
      .gte("member_count", 2)
      .gte("last_updated_at", since)
      .order("trending_score", { ascending: false })
      .limit(MAX_CLUSTERS),
    supabase
      .from("items")
      .select("id, url, title, author, engagement_score")
      .in("source_id", twitterIds)
      .not("enriched_at", "is", null)
      .is("duplicate_of", null)
      .gte("ingested_at", since)
      .order("engagement_score", { ascending: false })
      .limit(MAX_SOLO + 20), // buffer so we still have solos after removing cluster members
  ]);

  if (tweetsRes.error) return Response.json({ error: tweetsRes.error.message }, { status: 500 });
  const clusterRows: ClusterRow[] = clustersRes.error
    ? (console.warn("x-brief clusters load:", clustersRes.error.message), [])
    : ((clustersRes.data ?? []) as ClusterRow[]);

  // Member posts per cluster (for the citations) + the set of clustered item ids
  // (so the solo list doesn't double-count them).
  const membersByCluster = new Map<string, { url: string; handle: string }[]>();
  const clusteredItemIds = new Set<string>();
  if (clusterRows.length > 0) {
    const { data: memberData, error: memberErr } = await supabase
      .from("x_topic_members")
      .select("topic_id, item_id, items(url, author)")
      .in("topic_id", clusterRows.map((c) => c.id));
    if (memberErr) {
      console.warn("x-brief members load:", memberErr.message);
    } else {
      for (const m of (memberData ?? []) as unknown as MemberRow[]) {
        clusteredItemIds.add(m.item_id);
        if (!m.items?.url) continue;
        const arr = membersByCluster.get(m.topic_id) ?? [];
        if (arr.length < MEMBERS_PER_CLUSTER) {
          arr.push({ url: m.items.url, handle: cleanHandle(m.items.author) });
        }
        membersByCluster.set(m.topic_id, arr);
      }
    }
  }

  const solo = ((tweetsRes.data ?? []) as TweetRow[])
    .filter((t) => !clusteredItemIds.has(t.id))
    .slice(0, MAX_SOLO);

  // Number the sources: clusters first (stronger signal), then solo posts. Build
  // the parallel citation map keyed by the same [n].
  const sources: XSourceInput[] = [];
  const citations: Record<string, XCitation> = {};
  let n = 0;
  for (const c of clusterRows) {
    const posts = membersByCluster.get(c.id) ?? [];
    if (posts.length === 0) continue; // no linkable posts → not citeable
    n += 1;
    sources.push({
      n,
      kind: "cluster",
      label: c.label,
      text: c.summary ?? c.label,
      memberCount: c.member_count,
    });
    citations[n] = { label: c.label, posts };
  }
  for (const t of solo) {
    n += 1;
    const handle = cleanHandle(t.author);
    sources.push({
      n,
      kind: "post",
      label: `@${handle}`,
      text: t.title,
      engagement: Number(t.engagement_score) || 0,
    });
    citations[n] = { label: `@${handle}`, posts: [{ url: t.url, handle }] };
  }

  if (sources.length === 0) {
    return Response.json({ ok: true, skipped: true, reason: "no recent tweets or clusters" });
  }

  const period = { start: since, end: new Date().toISOString() };
  const userMsg = buildXBriefUserMessage(sources, period);

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
    if (!sections.pulse.trim() && !sections.threads.trim() && !sections.spotted.trim()) {
      return Response.json({ error: "model returned empty brief" }, { status: 502 });
    }
    markdown = renderXBriefMarkdown(sections, period, sources.length);
  } catch (e) {
    return Response.json({ error: `brief generation: ${(e as Error).message}` }, { status: 502 });
  }

  const { error: insErr } = await supabase.from("briefs").insert({
    surface: "x",
    period_start: period.start,
    period_end: period.end,
    markdown,
    sections,
    citations,
    model: X_BRIEF_MODEL,
    item_count: sources.length,
  });
  if (insErr) return Response.json({ error: insErr.message }, { status: 500 });

  return Response.json({
    ok: true,
    generated: true,
    sources: sources.length,
    clusters: clusterRows.length,
    solo: solo.length,
  });
}

export const POST = GET;
