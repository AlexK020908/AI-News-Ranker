import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}

async function handle(req: NextRequest): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const token = searchParams.get("token");
  if (!id || !token) {
    return Response.json({ error: "missing id or token" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("webhooks")
    .select("id, manage_token")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return renderHtml("Subscription not found.", 404);
  }
  if (data.manage_token !== token) {
    return renderHtml("Invalid unsubscribe token.", 403);
  }

  const { error: delErr } = await supabase.from("webhooks").delete().eq("id", id);
  if (delErr) {
    return Response.json({ error: delErr.message }, { status: 500 });
  }

  return renderHtml("Unsubscribed. You'll stop receiving ai-news-feed pings.", 200);
}

function renderHtml(message: string, status: number): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>ai-news-feed</title>
<style>body{background:#0a0a0a;color:#e5e5e5;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:32rem;padding:2rem;text-align:center}a{color:#a78bfa}</style>
</head><body><main><h1 style="font-size:1.25rem;margin-bottom:1rem">ai-news-feed</h1><p>${escape(message)}</p><p><a href="/">← back to feed</a></p></main></body></html>`;
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
