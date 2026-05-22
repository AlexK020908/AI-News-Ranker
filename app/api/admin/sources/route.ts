import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthorizedJob } from "@/lib/job-auth";
import { SOURCE_KINDS } from "@/lib/types";

// Admin endpoint for source management from local scripts. Auth piggybacks
// on CRON_SECRET — same Bearer used by the jobs routes — so scripts that
// already have the secret don't need to figure out Supabase's API key
// format (especially the new sb_secret_* keys, which behave differently
// from JWT-shaped keys in PostgREST's header validation).
//
// Use case: scripts/ingest-hf-papers.ps1 needs to upsert a source row
// before triggering ingest; this endpoint lets it do that without
// reaching directly into PostgREST.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sourcePayloadSchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(200),
  kind: z.enum(SOURCE_KINDS),
  region: z.string().min(1).max(32).default("global"),
  config: z.record(z.string(), z.unknown()).default({}),
  poll_interval_sec: z.number().int().positive().max(86_400).default(3600),
});

export async function POST(req: NextRequest) {
  if (!isAuthorizedJob(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "invalid json body" }, { status: 400 });
  }

  const parsed = sourcePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const supabase = createSupabaseServiceClient();
  // Upsert by slug. ignoreDuplicates: existing rows are left alone so we
  // never silently clobber a hand-tuned config in the DB. The caller can
  // tell create-vs-already-existed from the returned `created` flag.
  const { data, error } = await supabase
    .from("sources")
    .upsert(parsed.data, { onConflict: "slug", ignoreDuplicates: true })
    .select("id, slug, kind");
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  if (data && data.length > 0) {
    return Response.json({ ok: true, created: true, source: data[0] });
  }

  // Existed already — fetch it so the caller still gets the id back.
  const { data: existing, error: lookupErr } = await supabase
    .from("sources")
    .select("id, slug, kind")
    .eq("slug", parsed.data.slug)
    .maybeSingle();
  if (lookupErr) {
    return Response.json({ error: lookupErr.message }, { status: 500 });
  }
  return Response.json({ ok: true, created: false, source: existing });
}
