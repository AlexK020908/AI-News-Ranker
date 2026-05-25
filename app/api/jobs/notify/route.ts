import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedJob } from "@/lib/job-auth";
import { buildItemEmbed, postToDiscord, type NotifyItem } from "@/lib/webhooks";
import { sendEmail, buildItemAlertEmail, type EmailItem } from "@/lib/email";
import { runPool } from "@/lib/utils";
import { SITE_URL } from "@/lib/site";
import type { Category } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Only consider items enriched within this window — avoids firing alerts for
// backfills / reprocessed history.
const LOOKBACK_HOURS = 12;
const CONCURRENCY = 4;
// Email subs receive a single bundled email per tick rather than N separate
// messages. The bundle cap prevents a backfill burst from producing a
// wall-of-text email; remaining items land on the next tick (still
// deduplicated via webhook_deliveries).
const EMAIL_BUNDLE_MAX = 8;

interface WebhookRow {
  id: string;
  kind: "discord" | "email";
  url: string | null;
  email: string | null;
  min_importance: number;
  categories: Category[];
  manage_token: string;
  is_digest: boolean | null;
  confirmed_at: string | null;
  created_at: string;
}

interface CandidateItem {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  importance: number | null;
  category: Category | null;
  duplicate_count: number;
  published_at: string | null;
  enriched_at: string;
  source: { name: string };
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

  // Exclude digest subscribers: a webhook that opted into the daily
  // digest does NOT want a stream of per-item alerts on top.
  const { data: webhooks, error: wErr } = await supabase
    .from("webhooks")
    .select("id, kind, url, email, min_importance, categories, manage_token, is_digest, confirmed_at, created_at")
    .eq("enabled", true)
    .or("is_digest.is.null,is_digest.eq.false");

  if (wErr) return Response.json({ error: wErr.message }, { status: 500 });
  // Email subs must be confirmed (double-opt-in); Discord subs were
  // implicitly verified by a successful ping at registration time so they
  // don't carry a confirmed_at.
  const subs = (webhooks ?? []).filter((s) =>
    s.kind === "discord" || (s.kind === "email" && s.confirmed_at),
  ) as WebhookRow[];
  if (subs.length === 0) return Response.json({ ok: true, webhooks: 0, delivered: 0 });

  const minThreshold = Math.min(...subs.map((s) => s.min_importance));
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();

  const { data: items, error: iErr } = await supabase
    .from("items")
    .select(
      `id, title, url, summary, importance, category, duplicate_count,
       published_at, enriched_at, source:sources!inner(name)`,
    )
    .not("enriched_at", "is", null)
    .is("duplicate_of", null)
    .gte("importance", minThreshold)
    .gte("enriched_at", since)
    .order("enriched_at", { ascending: false })
    .limit(200);

  if (iErr) return Response.json({ error: iErr.message }, { status: 500 });
  const candidates = (items ?? []) as unknown as CandidateItem[];
  if (candidates.length === 0) return Response.json({ ok: true, webhooks: subs.length, delivered: 0 });

  // `??` would let an empty NEXT_PUBLIC_SITE_URL through as "", producing
  // relative `/api/webhooks/...` links in messages. SITE_URL uses `||` with a
  // production fallback, so the origin is always an absolute https URL.
  const origin = SITE_URL;

  let delivered = 0;
  let failed = 0;

  for (const sub of subs) {
    // Don't flush the existing backlog at a fresh subscriber: only send items
    // the pipeline enriched AFTER they joined. For email, "joined" means
    // confirmed_at (they're inactive until they confirm); Discord subs have no
    // confirmed_at, so created_at is the cutoff. webhook_deliveries dedupe still
    // applies on top — this just stops the initial dump of pre-existing items.
    const subscribedAt = sub.confirmed_at ?? sub.created_at;
    const eligible = candidates.filter((it) => {
      const imp = it.importance ?? 0;
      if (imp < sub.min_importance) return false;
      if (sub.categories.length > 0 && (!it.category || !sub.categories.includes(it.category))) {
        return false;
      }
      // Compare as instants, not strings: PostgREST timestamptz values can
      // vary in fractional-second width (".000" vs none), which makes a
      // lexicographic <= misorder two times within the same second.
      if (Date.parse(it.enriched_at) <= Date.parse(subscribedAt)) return false;
      return true;
    });
    if (eligible.length === 0) continue;

    const { data: already, error: dErr } = await supabase
      .from("webhook_deliveries")
      .select("item_id")
      .eq("webhook_id", sub.id)
      .in("item_id", eligible.map((e) => e.id));

    if (dErr) {
      console.error("deliveries lookup failed", dErr.message);
      continue;
    }
    const sentIds = new Set((already ?? []).map((r) => r.item_id as string));
    // Discord splits into multiple messages (chat scroll = unit of
    // consumption). Email bundles into ONE message (inbox = unit of
    // consumption, separate emails are spam-grade UX). Both paths still
    // record per-item delivery rows for dedupe.
    const perSubCap = sub.kind === "email" ? EMAIL_BUNDLE_MAX : 10;
    const toSend = eligible.filter((e) => !sentIds.has(e.id)).slice(0, perSubCap);
    if (toSend.length === 0) continue;

    const unsubscribeUrl = `${origin}/api/webhooks/unsubscribe?id=${sub.id}&token=${sub.manage_token}`;

    if (sub.kind === "discord" && sub.url) {
      const discordUrl = sub.url;
      // Tally successes in-pool and write the counter ONCE after the pool
      // drains. Per-item updates here would race: CONCURRENCY workers each do a
      // read-modify-write on the same webhook's delivery_count, clobbering each
      // other so the count under-reports. (JS is single-threaded, so the ++ is
      // safe; the DB read-modify-write is what races.)
      let okCount = 0;
      await runPool(toSend, CONCURRENCY, async (it) => {
        const notifyItem: NotifyItem = {
          id: it.id,
          title: it.title,
          url: it.url,
          summary: it.summary,
          importance: it.importance,
          category: it.category,
          duplicate_count: it.duplicate_count,
          source_name: it.source.name,
          published_at: it.published_at,
        };
        const payload = buildItemEmbed(notifyItem, unsubscribeUrl);
        const res = await postToDiscord(discordUrl, payload);

        if (res.ok) {
          // Record the delivery ONLY on success. webhook_deliveries has PK
          // (webhook_id, item_id) and is write-once, so recording a failed
          // send would permanently block the retry — the dedupe lookup above
          // would treat the item as already delivered. Leaving the slot empty
          // lets the next tick resend after a transient Discord failure.
          await supabase.from("webhook_deliveries").insert({
            webhook_id: sub.id,
            item_id: it.id,
            status: "ok",
          });
          delivered++;
          okCount++;
        } else {
          failed++;
          // Discord returns 404/410 for deleted webhooks — auto-disable so we stop retrying.
          if (res.status === 404 || res.status === 410) {
            await supabase.from("webhooks").update({ enabled: false }).eq("id", sub.id);
          }
        }
      });
      if (okCount > 0) {
        await supabase
          .from("webhooks")
          .update({
            last_delivered_at: new Date().toISOString(),
            delivery_count: await incrementCount(supabase, sub.id, okCount),
          })
          .eq("id", sub.id);
      }
    } else if (sub.kind === "email" && sub.email) {
      const emailItems: EmailItem[] = toSend.map((it) => ({
        title: it.title,
        url: it.url,
        summary: it.summary,
        importance: it.importance,
        category: it.category,
        duplicate_count: it.duplicate_count,
        source_name: it.source.name,
        published_at: it.published_at,
      }));
      const tmpl = buildItemAlertEmail(emailItems, unsubscribeUrl);
      const res = await sendEmail({
        to: sub.email,
        subject: tmpl.subject,
        html: tmpl.html,
        text: tmpl.text,
        listUnsubscribeUrl: unsubscribeUrl,
      });
      if (res.ok) {
        // Record deliveries ONLY on success — see the Discord branch: the
        // (webhook_id, item_id) PK is write-once, so a recorded failure would
        // permanently suppress the retry. One row per bundled item keeps the
        // dedupe contract identical across channels.
        const rows = toSend.map((it) => ({
          webhook_id: sub.id,
          item_id: it.id,
          status: "ok",
        }));
        await supabase.from("webhook_deliveries").insert(rows);
        delivered += toSend.length;
        await supabase
          .from("webhooks")
          .update({
            last_delivered_at: new Date().toISOString(),
            delivery_count: await incrementCount(supabase, sub.id, toSend.length),
          })
          .eq("id", sub.id);
      } else {
        failed += toSend.length;
      }
    }
  }

  return Response.json({
    ok: true,
    webhooks: subs.length,
    candidates: candidates.length,
    delivered,
    failed,
  });
}

export const POST = GET;

async function incrementCount(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  id: string,
  by: number = 1,
): Promise<number> {
  const { data } = await supabase
    .from("webhooks")
    .select("delivery_count")
    .eq("id", id)
    .maybeSingle();
  return (data?.delivery_count ?? 0) + by;
}
