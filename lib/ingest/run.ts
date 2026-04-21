import type { SupabaseClient } from "@supabase/supabase-js";
import type { Source } from "@/lib/types";
import { runPool } from "@/lib/utils";
import { adapters } from "./registry";
import { upsertItems } from "./write";
import { pruneOldItems } from "./retention";

export interface RunResult {
  sourceSlug: string;
  attempted: number;
  inserted: number;
  skipped: number;
  error: string | null;
  durationMs: number;
}

export interface IngestSummary {
  results: RunResult[];
  pruned: number;
  cutoff: string;
}

export async function runIngestionForSource(
  supabase: SupabaseClient,
  source: Source,
): Promise<RunResult> {
  const started = Date.now();
  const adapter = adapters[source.kind];
  if (!adapter) {
    return empty(source.slug, `no adapter for kind=${source.kind}`, started);
  }
  try {
    const result = await adapter({
      sourceSlug: source.slug,
      sourceName: source.name,
      sourceKind: source.kind,
      config: (source.config ?? {}) as Record<string, unknown>,
    });
    if (result.error && result.items.length === 0) {
      await markPolled(supabase, source.id, result.error);
      return empty(source.slug, result.error, started);
    }
    const { inserted, skipped } = await upsertItems(supabase, source.id, result.items);
    await markPolled(supabase, source.id, result.error ?? null);
    return {
      sourceSlug: source.slug,
      attempted: result.items.length,
      inserted,
      skipped,
      error: result.error ?? null,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    const msg = (e as Error).message || String(e);
    await markPolled(supabase, source.id, msg);
    return empty(source.slug, msg, started);
  }
}

function empty(slug: string, error: string, started: number): RunResult {
  return {
    sourceSlug: slug,
    attempted: 0,
    inserted: 0,
    skipped: 0,
    error,
    durationMs: Date.now() - started,
  };
}

async function markPolled(supabase: SupabaseClient, id: string, error: string | null) {
  await supabase
    .from("sources")
    .update({ last_polled_at: new Date().toISOString(), last_error: error })
    .eq("id", id);
}

export async function runIngestionForAll(
  supabase: SupabaseClient,
  opts: { concurrency?: number; onlySlugs?: string[] } = {},
): Promise<IngestSummary> {
  // Sweep stale items first so they're gone before any new backfill lands.
  const { deleted: pruned, cutoff } = await pruneOldItems(supabase);

  let query = supabase
    .from("sources")
    .select("id, slug, name, kind, config, poll_interval_sec, enabled, last_polled_at, last_error, created_at")
    .eq("enabled", true)
    .order("slug");
  if (opts.onlySlugs?.length) query = query.in("slug", opts.onlySlugs);

  const { data: sources, error } = await query;
  if (error) throw new Error(`load sources: ${error.message}`);

  const all = (sources ?? []) as Source[];
  const results: RunResult[] = [];
  await runPool(all, opts.concurrency ?? 4, async (source) => {
    const r = await runIngestionForSource(supabase, source);
    results.push(r);
  });
  return { results, pruned, cutoff };
}
