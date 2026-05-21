import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCache } from "@/lib/cache/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Validates sendBeacon payload from <StoryPanels>. sid is an anonymous UUID
// the client mints in localStorage on first visit — used purely to dedup the
// same person refreshing 50× and inflating the count.
const EventBody = z.object({
  topic_id: z.string().uuid(),
  sid:      z.string().min(8).max(64),
  kind:     z.enum(["view", "click"]),
});

const DEDUP_TTL_SEC = 3600;  // one count per (topic, hour, sid)
const BUCKET_MS = 3_600_000; // hourly buckets, matches topic_engagement.bucket_start grain

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = EventBody.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  const { topic_id, sid, kind } = parsed.data;

  const bucketStartMs = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
  const bucketStartIso = new Date(bucketStartMs).toISOString();
  const claimKey = `seen:${kind}:${topic_id}:${bucketStartMs}:${sid}`;

  const claimed = await getCache().tryClaim(claimKey, DEDUP_TTL_SEC);
  if (!claimed) {
    return Response.json({ ok: true, deduped: true });
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }

  // UPSERT a row per (topic, hour) and atomically bump the right counter.
  // Doing it via raw RPC keeps it to one round-trip.
  const { error } = await supabase.rpc("bump_topic_engagement", {
    in_topic_id:     topic_id,
    in_bucket_start: bucketStartIso,
    in_kind:         kind,
  });
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
