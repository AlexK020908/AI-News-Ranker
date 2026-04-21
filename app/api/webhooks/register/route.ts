import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  generateManageToken,
  isDiscordWebhookUrl,
  postToDiscord,
} from "@/lib/webhooks";
import { CATEGORIES } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RegisterBody = z.object({
  url: z.string().url().max(512),
  min_importance: z.number().int().min(0).max(100).default(80),
  categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length).default([]),
});

export async function POST(req: NextRequest) {
  let parsed;
  try {
    const json = await req.json();
    parsed = RegisterBody.parse(json);
  } catch (e) {
    return Response.json(
      { error: "invalid body", detail: (e as Error).message.slice(0, 200) },
      { status: 400 },
    );
  }

  if (!isDiscordWebhookUrl(parsed.url)) {
    return Response.json(
      { error: "only Discord webhook URLs are supported" },
      { status: 400 },
    );
  }

  const ping = await postToDiscord(parsed.url, {
    content:
      "Subscribed to ai-news-feed. You'll start receiving items here once they cross your importance threshold.",
    username: "ai-news-feed",
  });
  if (!ping.ok) {
    return Response.json(
      { error: "webhook ping failed", status: ping.status, detail: ping.error },
      { status: 400 },
    );
  }

  const manage_token = generateManageToken();

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("webhooks")
    .upsert(
      {
        url: parsed.url,
        min_importance: parsed.min_importance,
        categories: parsed.categories,
        enabled: true,
        manage_token,
      },
      { onConflict: "url" },
    )
    .select("id")
    .single();

  if (error || !data) {
    return Response.json(
      { error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    id: data.id,
    manage_token,
    unsubscribe_url: buildUnsubscribeUrl(req, data.id, manage_token),
  });
}

function buildUnsubscribeUrl(req: NextRequest, id: string, token: string): string {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ??
    `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  return `${origin}/api/webhooks/unsubscribe?id=${id}&token=${token}`;
}
