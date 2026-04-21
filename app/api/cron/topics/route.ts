import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Default window + similarity matches the migration's defaults. Kept here so
// operators can override per-run via query string without editing SQL.
const DEFAULT_HOURS = 48;
const DEFAULT_THRESHOLD = 0.72;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const hours = Math.max(
    1,
    Math.min(168, Number(searchParams.get("hours")) || DEFAULT_HOURS),
  );
  const threshold = Math.max(
    0.5,
    Math.min(0.95, Number(searchParams.get("threshold")) || DEFAULT_THRESHOLD),
  );

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  const started = Date.now();
  const { data, error } = await supabase.rpc("recompute_topic_sizes", {
    window_hours: hours,
    topic_threshold: threshold,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({
    ok: true,
    updated: data ?? 0,
    window_hours: hours,
    threshold,
    durationMs: Date.now() - started,
  });
}

export const POST = GET;
