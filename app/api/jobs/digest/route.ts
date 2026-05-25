import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedJob } from "@/lib/job-auth";
import { getAnthropic } from "@/lib/anthropic/client";
import {
  DIGEST_MODEL,
  DIGEST_SYSTEM_PROMPT,
  buildDigestUserMessage,
  renderDigestMarkdown,
  isDigestSections,
  type DigestItemInput,
  type DigestSections,
} from "@/lib/anthropic/digest-prompt";
import { postToDiscord } from "@/lib/webhooks";
import { sendEmail, buildDigestEmail } from "@/lib/email";
import { extractJsonBlock, runPool } from "@/lib/utils";
import { SITE_URL } from "@/lib/site";
import type { Category } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// 24-hour briefing window. Periods are aligned to midnight UTC so a loop
// firing every 15 minutes inside the same UTC day all map onto the same
// (period_start, period_end) tuple — the unique constraint then makes
// duplicate generation a no-op.
const PERIOD_HOURS = 24;
const MIN_IMPORTANCE = 60;
const MAX_ITEMS_FOR_PROMPT = 50;
// trending_items has no time filter, so it can return items days old.
// We over-fetch and then post-filter to items whose published_at OR
// ingested_at falls inside the period — guaranteeing the LLM only sees
// items the system prompt's "last 24 hours" claim is actually true for.
const TRENDING_OVERFETCH = 200;
const DISCORD_CHUNK_LIMIT = 1900;     // Discord message body cap is 2000 — leave headroom.
const DISCORD_INTERCHUNK_MS = 350;    // ~3 messages/s, well under Discord's per-webhook rate limit.

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
  paper_influential_citations: number | null;
  published_at: string | null;
  ingested_at: string;
  trending_score: number;
}

interface SourceRow {
  id: string;
  name: string;
}

interface DigestWebhookRow {
  id: string;
  kind: "discord" | "email";
  url: string | null;
  email: string | null;
  manage_token: string;
  confirmed_at: string | null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedJob(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  // ?force=1 regenerates an existing digest; by default it does NOT
  // re-push to subscribers (avoid spamming on a typo-fix rerun). Operators
  // can opt back in with ?force=1&push=1.
  const allowPush = !force || searchParams.get("push") === "1";
  const period = currentPeriod();

  // Atomic claim: insert a placeholder row with onConflict-ignore. If we
  // get a row back, we won the race and proceed. If we get nothing back,
  // another worker (or a previous successful tick) already has this
  // period — bail without burning an Anthropic call. The unique
  // constraint on (period_start, period_end) is what makes this safe.
  let claimedId: string | null = null;
  let claimedExisted = false;
  if (!force) {
    const { data: claimed, error: claimErr } = await supabase
      .from("digests")
      .upsert(
        {
          period_start: period.start,
          period_end: period.end,
          markdown: "(generating)",
          sections: { _generating: true } as Record<string, unknown>,
          item_count: 0,
        },
        { onConflict: "period_start,period_end", ignoreDuplicates: true },
      )
      .select("id");
    if (claimErr) {
      return Response.json({ error: `claim: ${claimErr.message}` }, { status: 500 });
    }
    if (!claimed || claimed.length === 0) {
      // Another worker won the race, OR a digest already exists.
      const { data: existing } = await supabase
        .from("digests")
        .select("id, generated_at")
        .eq("period_start", period.start)
        .eq("period_end", period.end)
        .maybeSingle();
      return Response.json({
        ok: true,
        skipped: true,
        reason: "digest already claimed for period",
        digest_id: existing?.id ?? null,
        generated_at: existing?.generated_at ?? null,
      });
    }
    claimedId = claimed[0].id;
  } else {
    // force=1 path: look up existing id (if any) so we update in place.
    const { data: existing } = await supabase
      .from("digests")
      .select("id")
      .eq("period_start", period.start)
      .eq("period_end", period.end)
      .maybeSingle();
    claimedId = existing?.id ?? null;
    claimedExisted = !!existing;
  }

  // Pull top items via trending_items. The SQL function has no time
  // filter so we over-fetch and post-filter to the period below — that
  // way the system prompt's "last 24 hours" claim is actually true.
  const { data: trending, error: tErr } = await supabase.rpc("trending_items", {
    min_importance: MIN_IMPORTANCE,
    cat: null,
    source_kinds: null,
    max_rows: TRENDING_OVERFETCH,
  });
  if (tErr) {
    return Response.json({ error: `trending_items: ${tErr.message}` }, { status: 500 });
  }

  const allRows = (trending ?? []) as TrendingItemRow[];
  // Keep only items whose published_at falls in [period.start, period.end).
  // For items with null published_at, fall back to ingested_at — the
  // RSS adapter can produce items with no published timestamp but the
  // ingest tick stamps every row.
  const periodStartMs = Date.parse(period.start);
  const periodEndMs = Date.parse(period.end);
  const rows = allRows
    .filter((r) => {
      const stamp = r.published_at ?? r.ingested_at;
      if (!stamp) return false;
      const t = Date.parse(stamp);
      return Number.isFinite(t) && t >= periodStartMs && t < periodEndMs;
    })
    .slice(0, MAX_ITEMS_FOR_PROMPT);

  if (rows.length === 0) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: "no items above importance threshold in 24h window",
      candidates: allRows.length,
    });
  }

  // Resolve source names in a single follow-up query. trending_items doesn't
  // join sources so we look them up here rather than touch the RPC.
  const sourceIds = Array.from(
    new Set(rows.map((r) => r.source_id).filter(Boolean)),
  );
  let sourceById = new Map<string, string>();
  if (sourceIds.length > 0) {
    const { data: srcs } = await supabase
      .from("sources")
      .select("id, name")
      .in("id", sourceIds);
    sourceById = new Map(((srcs ?? []) as SourceRow[]).map((s) => [s.id, s.name]));
  }

  const promptItems: DigestItemInput[] = rows
    .filter((r) => r.title && r.title.length > 0)
    .slice(0, MAX_ITEMS_FOR_PROMPT)
    .map((r) => ({
      title: r.title,
      url: r.url,
      summary: r.summary,
      category: r.category,
      importance: r.importance,
      duplicate_count: r.duplicate_count,
      paper_tldr: r.paper_tldr,
      paper_influential_citations: r.paper_influential_citations,
      published_at: r.published_at,
      source_name: sourceById.get(r.source_id) ?? "unknown",
    }));

  let sections: DigestSections;
  try {
    sections = await generateDigest(promptItems, period);
  } catch (e) {
    return Response.json(
      { error: `digest generation failed: ${(e as Error).message}` },
      { status: 500 },
    );
  }

  const markdown = renderDigestMarkdown(sections, period, promptItems.length);

  const updatePayload = {
    markdown,
    sections: sections as unknown as Record<string, unknown>,
    item_count: promptItems.length,
    generated_at: new Date().toISOString(),
  };

  let stored: { id: string; generated_at: string } | null = null;
  if (claimedId) {
    // Update the row we claimed (or, in force=1 mode, the existing row).
    const { data, error: updErr } = await supabase
      .from("digests")
      .update(updatePayload)
      .eq("id", claimedId)
      .select("id, generated_at")
      .single();
    if (updErr) {
      return Response.json({ error: `store digest: ${updErr.message}` }, { status: 500 });
    }
    stored = data;
  } else {
    // force=1 with no pre-existing row — insert fresh.
    const { data, error: insErr } = await supabase
      .from("digests")
      .insert({
        period_start: period.start,
        period_end: period.end,
        ...updatePayload,
      })
      .select("id, generated_at")
      .single();
    if (insErr) {
      return Response.json({ error: `store digest: ${insErr.message}` }, { status: 500 });
    }
    stored = data;
  }

  if (!allowPush) {
    return Response.json({
      ok: true,
      digest_id: stored.id,
      period_start: period.start,
      period_end: period.end,
      item_count: promptItems.length,
      regenerated: claimedExisted,
      pushed: 0,
      push_skipped_reason: "force=1 without push=1",
    });
  }

  // Push to digest-subscribed channels (Discord + confirmed email).
  // Item-level webhook subscribers are NOT touched — they get the
  // existing notify route.
  const { data: subsRaw, error: wErr } = await supabase
    .from("webhooks")
    .select("id, kind, url, email, manage_token, confirmed_at")
    .eq("enabled", true)
    .eq("is_digest", true);
  if (wErr) {
    // 500 not 200: a failed webhook lookup is indistinguishable from
    // "no subscribers" if we mask it as ok. Promote to error so the
    // scheduler logs a non-ok line and an operator can investigate.
    return Response.json(
      {
        ok: false,
        digest_id: stored.id,
        pushed: 0,
        error: `webhooks lookup: ${wErr.message}`,
      },
      { status: 500 },
    );
  }
  // Drop unconfirmed email subs — they don't receive anything until
  // they click the confirmation link.
  const subs = ((subsRaw ?? []) as DigestWebhookRow[]).filter((s) =>
    s.kind === "discord" || (s.kind === "email" && s.confirmed_at),
  );

  // SITE_URL uses `||` with a production fallback, so an empty
  // NEXT_PUBLIC_SITE_URL can't leak through as "" and produce relative
  // /api/... links in digest emails (the `??` pattern this replaced did).
  const origin = SITE_URL;
  const periodLabel = formatPeriodLabel(period.end);

  let pushed = 0;
  let pushFailed = 0;
  if (subs.length > 0) {
    await runPool(subs, 4, async (sub) => {
      const unsubscribeUrl = `${origin}/api/webhooks/unsubscribe?id=${sub.id}&token=${sub.manage_token}`;
      if (sub.kind === "discord" && sub.url) {
        const ok = await pushDigestToDiscord(sub.url, markdown);
        if (ok) pushed++;
        else pushFailed++;
      } else if (sub.kind === "email" && sub.email) {
        const tmpl = buildDigestEmail(markdown, periodLabel, unsubscribeUrl);
        const res = await sendEmail({
          to: sub.email,
          subject: tmpl.subject,
          html: tmpl.html,
          text: tmpl.text,
        });
        if (res.ok) pushed++;
        else pushFailed++;
      }
    });
  }

  return Response.json({
    ok: true,
    digest_id: stored.id,
    period_start: period.start,
    period_end: period.end,
    item_count: promptItems.length,
    subscribers: subs.length,
    pushed,
    push_failed: pushFailed,
  });
}

function formatPeriodLabel(endIso: string): string {
  try {
    return new Date(endIso).toISOString().slice(0, 10);
  } catch {
    return endIso;
  }
}

export const POST = GET;

async function generateDigest(
  items: DigestItemInput[],
  period: { start: string; end: string },
): Promise<DigestSections> {
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: DIGEST_MODEL,
    max_tokens: 4000,
    system: [
      {
        type: "text",
        text: DIGEST_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildDigestUserMessage(items, period) }],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("no text block in response");
  }
  const block = extractJsonBlock(text.text);
  if (!block) throw new Error("no JSON body in response");
  const parsed = JSON.parse(block);
  if (!isDigestSections(parsed)) {
    throw new Error("digest sections schema mismatch");
  }
  return parsed;
}

// Returns the closed-open 24-hour window [yesterday-midnight-UTC,
// today-midnight-UTC). The digest is a retrospective summary, so we
// align to the most recent past midnight, NOT the next upcoming one.
// Every same-UTC-day call returns the same tuple → the (period_start,
// period_end) unique constraint is the idempotency mechanism for a
// 15-min scheduler. The window rolls at 00:00 UTC and the next tick
// after midnight starts generating the previous day's digest.
function currentPeriod(): { start: string; end: string } {
  const now = new Date();
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const start = new Date(end.getTime() - PERIOD_HOURS * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Discord rejects message bodies > 2000 chars. The digest will routinely
// exceed that, so we chunk on section boundaries and send each piece as
// its own message.
async function pushDigestToDiscord(url: string, markdown: string): Promise<boolean> {
  const chunks = chunkMarkdown(markdown, DISCORD_CHUNK_LIMIT);
  let anyFailed = false;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(DISCORD_INTERCHUNK_MS);
    const res = await postToDiscord(url, { content: chunks[i], username: "StackBrief" });
    if (!res.ok) anyFailed = true;
  }
  return !anyFailed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function chunkMarkdown(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  let buf: string[] = [];
  let bufLen = 0;

  const flush = () => {
    if (buf.length > 0) {
      out.push(buf.join("\n"));
      buf = [];
      bufLen = 0;
    }
  };

  for (const line of text.split("\n")) {
    // A single line longer than the limit can't go into buf as-is —
    // doing so would emit a chunk exceeding Discord's 2000-char body
    // cap. Hard-split such lines at the nearest whitespace below limit
    // (or at limit if no whitespace), flushing buf first.
    if (line.length > limit) {
      flush();
      let remaining = line;
      while (remaining.length > limit) {
        let cut = remaining.lastIndexOf(" ", limit);
        if (cut < Math.floor(limit / 2)) cut = limit;
        out.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).trimStart();
      }
      if (remaining.length > 0) {
        buf.push(remaining);
        bufLen = remaining.length + 1;
      }
      continue;
    }
    const ln = line.length + 1;
    if (bufLen + ln > limit) flush();
    buf.push(line);
    bufLen += ln;
  }
  flush();
  return out;
}
