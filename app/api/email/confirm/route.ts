import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const token = searchParams.get("token");
  if (!id || !token) {
    return renderHtml("Missing id or token in confirmation link.", 400);
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return renderHtml((e as Error).message, 500);
  }

  const { data, error } = await supabase
    .from("webhooks")
    .select("id, kind, manage_token, confirmed_at, email")
    .eq("id", id)
    .maybeSingle();

  if (error) return renderHtml(error.message, 500);
  if (!data) return renderHtml("Subscription not found. The link may be stale.", 404);
  if (data.kind !== "email") {
    return renderHtml("Not an email subscription.", 400);
  }
  if (data.manage_token !== token) {
    return renderHtml("Invalid confirmation token.", 403);
  }
  if (data.confirmed_at) {
    return renderHtml(
      `You're already subscribed as ${escape(data.email ?? "")}. Nothing else to do.`,
      200,
    );
  }

  const { error: updErr } = await supabase
    .from("webhooks")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", id);

  if (updErr) return renderHtml(updErr.message, 500);

  return renderHtml(
    `You're subscribed as <b>${escape(data.email ?? "")}</b>. The next briefing lands tomorrow morning UTC.`,
    200,
  );
}

function renderHtml(message: string, status: number): Response {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>StackBrief</title>
<style>
body{background:#0a0a0c;color:#ececef;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;}
main{max-width:32rem;text-align:center;background:#101013;border:1px solid rgba(255,255,255,0.14);border-radius:14px;padding:36px;}
h1{font-size:20px;margin:0 0 14px 0;letter-spacing:-0.01em;}
.eyebrow{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#f5a73c;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:18px;}
p{color:rgba(236,236,239,0.72);line-height:1.55;margin:0 0 18px 0;}
a{color:#f5a73c;}
</style>
</head><body><main>
<div class="eyebrow">StackBrief</div>
<h1>Subscription</h1>
<p>${message}</p>
<p><a href="/">← back to the feed</a></p>
</main></body></html>`;
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
