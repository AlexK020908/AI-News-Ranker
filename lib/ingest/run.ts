import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_REGION, type Source } from "@/lib/types";
import { runPool } from "@/lib/utils";
import { adapters } from "./registry";
import { upsertItems } from "./write";
import { pruneOldItems, pruneOldSnapshots } from "./retention";

export interface RunResult {
  sourceSlug: string;
  attempted: number;
  inserted: number;
  skipped: number;
  snapshots: number;
  snapshot_errors: number;
  error: string | null;
  durationMs: number;
}

export interface IngestSummary {
  results: RunResult[];
  pruned: number;
  cutoff: string;
  pruned_snapshots: number;
  snapshot_cutoff: string;
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
  const region = source.region ?? DEFAULT_REGION;
  try {
    const result = await adapter({
      sourceSlug: source.slug,
      sourceName: source.name,
      sourceKind: source.kind,
      config: (source.config ?? {}) as Record<string, unknown>,
      region,
      crawlConfig: (source.crawl_config ?? {}) as Record<string, unknown>,
    });
    if (result.error && result.items.length === 0) {
      await markPolled(supabase, source.id, result.error);
      return empty(source.slug, result.error, started);
    }
    const { inserted, skipped, snapshots, snapshot_errors } = await upsertItems(
      supabase,
      source.id,
      result.items,
      { defaultRegion: region },
    );
    await markPolled(supabase, source.id, result.error ?? null);
    return {
      sourceSlug: source.slug,
      attempted: result.items.length,
      inserted,
      skipped,
      snapshots,
      snapshot_errors,
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
    snapshots: 0,
    snapshot_errors: 0,
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
  // Snapshot pruning is independent of item pruning — snapshots cascade-
  // delete when their parent item is removed, so this only catches rows
  // whose items are still inside the item retention window but whose
  // observation is older than the snapshot window.
  const { deleted: pruned, cutoff } = await pruneOldItems(supabase);
  // Snapshot pruning is best-effort: if migration 005 hasn't landed yet
  // the table doesn't exist, and we don't want to take down the entire
  // ingest pipeline while waiting for a deploy to apply migrations.
  let prunedSnaps = 0;
  let snapCutoff = "";
  try {
    const r = await pruneOldSnapshots(supabase);
    prunedSnaps = r.deleted;
    snapCutoff = r.cutoff;
  } catch (e) {
    console.warn("prune snapshots (best-effort, ignoring):", (e as Error).message);
  }

  let query = supabase
    .from("sources")
    .select(
      "id, slug, name, kind, config, poll_interval_sec, enabled, reputation_weight, region, crawl_config, last_polled_at, last_error, created_at",
    )
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
  return {
    results,
    pruned,
    cutoff,
    pruned_snapshots: prunedSnaps,
    snapshot_cutoff: snapCutoff,
  };
}
