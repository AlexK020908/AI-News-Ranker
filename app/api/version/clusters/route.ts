import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Cheap fingerprint of cluster state for the client poll loop. The home page
// hits this every 60s; if `ts` advances since the client's last poll, the
// client triggers a router.refresh() (or surfaces a "new updates" pill).
//
// Returns the latest topics.last_updated_at as a unix ms number plus a count
// of topics in the 72h freshness window — together these change whenever the
// cluster-topics job inserts/updates anything visible on the homepage.
//
// Unauthenticated by design: nothing sensitive leaks (a single timestamp +
// integer count), and gating it would force the client to ship CRON_SECRET.
export async function GET() {
  try {
    const supabase = createSupabaseServiceClient();
    const since = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    const { data, error } = await supabase
      .from("topics")
      .select("last_updated_at")
      .gte("last_updated_at", since)
      .order("last_updated_at", { ascending: false })
      .limit(1);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const { count, error: cErr } = await supabase
      .from("topics")
      .select("id", { count: "exact", head: true })
      .gte("last_updated_at", since);
    if (cErr) {
      return Response.json({ error: cErr.message }, { status: 500 });
    }

    const tsIso = data?.[0]?.last_updated_at ?? null;
    const ts = tsIso ? Date.parse(tsIso) : 0;
    return Response.json(
      { ts, count: count ?? 0 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
