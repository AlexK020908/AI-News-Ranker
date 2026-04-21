import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { buildItemEmbed, postToDiscord, type NotifyItem } from "@/lib/webhooks";
import { runPool } from "@/lib/utils";
import type { Category } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// Only consider items enriched within this window — avoids firing alerts for
// backfills / reprocessed history.
const LOOKBACK_HOURS = 12;
const CONCURRENCY = 4;

interface WebhookRow {
  id: string;
  url: string;
  min_importance: number;
  categories: Category[];
  manage_token: string;
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
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const { data: webhooks, error: wErr } = await supabase
    .from("webhooks")
    .select("id, url, min_importance, categories, manage_token")
    .eq("enabled", true);

  if (wErr) return Response.json({ error: wErr.message }, { status: 500 });
  const subs = (webhooks ?? []) as WebhookRow[];
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

  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  let delivered = 0;
  let failed = 0;

  for (const sub of subs) {
    const eligible = candidates.filter((it) => {
      const imp = it.importance ?? 0;
      if (imp < sub.min_importance) return false;
      if (sub.categories.length > 0 && (!it.category || !sub.categories.includes(it.category))) {
        return false;
      }
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
    const toSend = eligible.filter((e) => !sentIds.has(e.id)).slice(0, 10);
    if (toSend.length === 0) continue;

    const unsubscribeUrl = `${origin}/api/webhooks/unsubscribe?id=${sub.id}&token=${sub.manage_token}`;

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
      const res = await postToDiscord(sub.url, payload);
      const status = res.ok ? "ok" : `err:${res.status}`;

      await supabase.from("webhook_deliveries").insert({
        webhook_id: sub.id,
        item_id: it.id,
        status,
      });

      if (res.ok) {
        delivered++;
        await supabase
          .from("webhooks")
          .update({
            last_delivered_at: new Date().toISOString(),
            delivery_count: await incrementCount(supabase, sub.id),
          })
          .eq("id", sub.id);
      } else {
        failed++;
        // Discord returns 404/410 for deleted webhooks — auto-disable so we stop retrying.
        if (res.status === 404 || res.status === 410) {
          await supabase.from("webhooks").update({ enabled: false }).eq("id", sub.id);
        }
      }
    });
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
): Promise<number> {
  const { data } = await supabase
    .from("webhooks")
    .select("delivery_count")
    .eq("id", id)
    .maybeSingle();
  return (data?.delivery_count ?? 0) + 1;
}
