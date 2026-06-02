import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedJob } from "@/lib/job-auth";
import { postToDiscord } from "@/lib/webhooks";
import { sendEmail, buildDailyBriefEmail } from "@/lib/email";
import { runPool } from "@/lib/utils";
import { SITE_URL } from "@/lib/site";
import { etDayWindow, BRIEF_HOUR_ET } from "@/lib/schedule";
import { isNewsBriefSections, type NewsBriefSections } from "@/lib/anthropic/news-brief-prompt";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// The daily email is now a COMPOSER, not a generator. It runs once per ET day
// in the morning and stitches together the two briefs that the news-brief and
// x-brief jobs produced earlier in the same worker tick — no LLM call of its own. The
// email leads with the ranked "What's going on in AI Space" list and follows
// with the "What's being talked about in X" prose. Per-item instant alerts are
// a separate path (see /api/jobs/notify) and are untouched.

const DISCORD_CHUNK_LIMIT = 1900;     // Discord message body cap is 2000 — leave headroom.
const DISCORD_INTERCHUNK_MS = 350;    // ~3 messages/s, well under Discord's per-webhook rate limit.

interface DigestWebhookRow {
  id: string;
  kind: "discord" | "email";
  url: string | null;
  email: string | null;
  manage_token: string;
  confirmed_at: string | null;
}

interface BriefCitation {
  label: string;
  posts: { url: string; handle: string }[];
}

interface BriefRow {
  markdown: string;
  sections: unknown;
  citations: Record<string, BriefCitation> | null;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedJob(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const force = searchParams.get("force") === "1";
  // ?force=1 re-sends; by default a forced run does NOT re-push to subscribers
  // (avoid spamming on a rerun). Operators opt back in with ?force=1&push=1.
  const allowPush = !force || searchParams.get("push") === "1";
  const win = etDayWindow();

  // Gate: don't send before the morning send hour (ET).
  if (!force && !win.isAfterBriefHour) {
    return Response.json({ ok: true, skipped: true, reason: `before ${BRIEF_HOUR_ET}:00 ET`, hour_et: win.hourET });
  }

  // Pull today's briefs (generated earlier this tick). Check BEFORE claiming the
  // digest period — if neither brief is ready yet (e.g. both jobs skipped this
  // tick), we want a later tick to still be able to send, so we must not burn
  // the once-per-day claim here.
  const [newsBrief, xBrief] = await Promise.all([
    loadTodayBrief(supabase, "news", win.etMidnightUtc),
    loadTodayBrief(supabase, "x", win.etMidnightUtc),
  ]);
  if (!newsBrief && !xBrief) {
    return Response.json({ ok: true, skipped: true, reason: "no briefs generated today yet" });
  }

  const newsSections: NewsBriefSections | null =
    newsBrief && isNewsBriefSections(newsBrief.sections) ? newsBrief.sections : null;
  // Combined markdown — stored on the digest row and pushed to Discord subs.
  const combinedMarkdown = [newsBrief?.markdown, xBrief?.markdown]
    .filter((m): m is string => !!m && m.trim().length > 0)
    .join("\n\n");
  const itemCount = newsSections?.topics.length ?? 0;

  // Atomic once-per-ET-day claim on (period_start, period_end). The unique
  // constraint makes a duplicate insert a no-op; winning the claim = we send.
  let claimedId: string | null = null;
  let claimedExisted = false;
  if (!force) {
    const { data: claimed, error: claimErr } = await supabase
      .from("digests")
      .upsert(
        {
          period_start: win.periodStart,
          period_end: win.periodEnd,
          markdown: combinedMarkdown,
          sections: { news: newsSections } as Record<string, unknown>,
          item_count: itemCount,
        },
        { onConflict: "period_start,period_end", ignoreDuplicates: true },
      )
      .select("id");
    if (claimErr) {
      return Response.json({ error: `claim: ${claimErr.message}` }, { status: 500 });
    }
    if (!claimed || claimed.length === 0) {
      const { data: existing } = await supabase
        .from("digests")
        .select("id, generated_at")
        .eq("period_start", win.periodStart)
        .eq("period_end", win.periodEnd)
        .maybeSingle();
      return Response.json({
        ok: true,
        skipped: true,
        reason: "email already sent for today (ET)",
        digest_id: existing?.id ?? null,
        generated_at: existing?.generated_at ?? null,
      });
    }
    claimedId = claimed[0].id;
  } else {
    const { data: existing } = await supabase
      .from("digests")
      .select("id")
      .eq("period_start", win.periodStart)
      .eq("period_end", win.periodEnd)
      .maybeSingle();
    claimedId = existing?.id ?? null;
    claimedExisted = !!existing;
  }

  const updatePayload = {
    markdown: combinedMarkdown,
    sections: { news: newsSections } as Record<string, unknown>,
    item_count: itemCount,
    generated_at: new Date().toISOString(),
  };

  let stored: { id: string } | null = null;
  if (claimedId) {
    const { data, error: updErr } = await supabase
      .from("digests")
      .update(updatePayload)
      .eq("id", claimedId)
      .select("id")
      .single();
    if (updErr) return Response.json({ error: `store digest: ${updErr.message}` }, { status: 500 });
    stored = data;
  } else {
    const { data, error: insErr } = await supabase
      .from("digests")
      .insert({ period_start: win.periodStart, period_end: win.periodEnd, ...updatePayload })
      .select("id")
      .single();
    if (insErr) return Response.json({ error: `store digest: ${insErr.message}` }, { status: 500 });
    stored = data;
  }

  if (!allowPush) {
    return Response.json({
      ok: true,
      digest_id: stored.id,
      et_day: win.etDay,
      item_count: itemCount,
      regenerated: claimedExisted,
      pushed: 0,
      push_skipped_reason: "force=1 without push=1",
    });
  }

  // Push to digest-subscribed channels (Discord + confirmed email). Item-level
  // webhook subscribers are NOT touched — they get the notify route.
  const { data: subsRaw, error: wErr } = await supabase
    .from("webhooks")
    .select("id, kind, url, email, manage_token, confirmed_at")
    .eq("enabled", true)
    .eq("is_digest", true);
  if (wErr) {
    return Response.json(
      { ok: false, digest_id: stored.id, pushed: 0, error: `webhooks lookup: ${wErr.message}` },
      { status: 500 },
    );
  }
  const subs = ((subsRaw ?? []) as DigestWebhookRow[]).filter(
    (s) => s.kind === "discord" || (s.kind === "email" && s.confirmed_at),
  );

  const origin = SITE_URL;
  const periodLabel = friendlyDay(win.etDay);

  let pushed = 0;
  let pushFailed = 0;
  if (subs.length > 0) {
    await runPool(subs, 4, async (sub) => {
      const unsubscribeUrl = `${origin}/api/webhooks/unsubscribe?id=${sub.id}&token=${sub.manage_token}`;
      if (sub.kind === "discord" && sub.url) {
        const ok = await pushDigestToDiscord(sub.url, combinedMarkdown);
        if (ok) pushed++;
        else pushFailed++;
      } else if (sub.kind === "email" && sub.email) {
        const tmpl = buildDailyBriefEmail({
          newsSections,
          newsCitations: newsBrief?.citations ?? null,
          xMarkdown: xBrief?.markdown ?? null,
          xCitations: xBrief?.citations ?? null,
          periodLabel,
          unsubscribeUrl,
        });
        const res = await sendEmail({
          to: sub.email,
          subject: tmpl.subject,
          html: tmpl.html,
          text: tmpl.text,
          listUnsubscribeUrl: unsubscribeUrl,
        });
        if (res.ok) pushed++;
        else pushFailed++;
      }
    });
  }

  return Response.json({
    ok: true,
    digest_id: stored.id,
    et_day: win.etDay,
    item_count: itemCount,
    has_news: !!newsSections,
    has_x: !!xBrief,
    subscribers: subs.length,
    pushed,
    push_failed: pushFailed,
  });
}

export const POST = GET;

async function loadTodayBrief(
  supabase: SupabaseClient,
  surface: string,
  sinceIso: string,
): Promise<BriefRow | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select("markdown, sections, citations")
    .eq("surface", surface)
    .gte("generated_at", sinceIso)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`digest: load ${surface} brief:`, error.message);
    return null;
  }
  return (data as BriefRow) ?? null;
}

function friendlyDay(etDay: string): string {
  const [y, m, d] = etDay.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (!m || !d) return etDay;
  return `${months[m - 1]} ${d}, ${y}`;
}

// Discord rejects message bodies > 2000 chars. The combined brief will exceed
// that, so we chunk on line boundaries and send each piece as its own message.
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
