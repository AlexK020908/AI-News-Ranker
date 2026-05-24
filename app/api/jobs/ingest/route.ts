import type { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { runIngestionForAll } from "@/lib/ingest/run";
import { isAuthorizedJob } from "@/lib/job-auth";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isAuthorizedJob(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const onlyParam = searchParams.get("only");
  const onlySlugs = onlyParam ? onlyParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const concurrency = Number(searchParams.get("concurrency") ?? 4);
  // ?force=1 bypasses the per-source due-time gate. Worker ticks omit it so
  // sources respect their own poll_interval_sec; manual curl can opt in.
  const force = searchParams.get("force") === "1";

  try {
    const supabase = createSupabaseServiceClient();
    const { results, pruned, cutoff, pruned_snapshots, snapshot_cutoff } =
      await runIngestionForAll(supabase, { onlySlugs, concurrency, force });
    const summary = {
      sources: results.length,
      attempted: results.reduce((n, r) => n + r.attempted, 0),
      inserted: results.reduce((n, r) => n + r.inserted, 0),
      skipped: results.reduce((n, r) => n + r.skipped, 0),
      snapshots: results.reduce((n, r) => n + r.snapshots, 0),
      snapshot_errors: results.reduce((n, r) => n + r.snapshot_errors, 0),
      errored: results.filter((r) => r.error).length,
      pruned,
      pruned_snapshots,
      retention_cutoff: cutoff,
      snapshot_cutoff,
    };
    return Response.json({ ok: true, summary, results });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

// External schedulers (Vercel, GitHub Actions, the worker container) call GET;
// manual triggers from curl can POST.
export const POST = GET;
