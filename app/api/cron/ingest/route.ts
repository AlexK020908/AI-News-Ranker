import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { runIngestionForAll } from "@/lib/ingest/run";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const onlyParam = searchParams.get("only");
  const onlySlugs = onlyParam ? onlyParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const concurrency = Number(searchParams.get("concurrency") ?? 4);

  try {
    const supabase = createSupabaseServiceClient();
    const { results, pruned, cutoff } = await runIngestionForAll(supabase, { onlySlugs, concurrency });
    const summary = {
      sources: results.length,
      attempted: results.reduce((n, r) => n + r.attempted, 0),
      inserted: results.reduce((n, r) => n + r.inserted, 0),
      skipped: results.reduce((n, r) => n + r.skipped, 0),
      errored: results.filter((r) => r.error).length,
      pruned,
      retention_cutoff: cutoff,
    };
    return Response.json({ ok: true, summary, results });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// Manual triggers use POST; Vercel cron uses GET.
export const POST = GET;
