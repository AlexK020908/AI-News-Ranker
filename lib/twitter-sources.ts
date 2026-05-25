import type { SupabaseClient } from "@supabase/supabase-js";

// IDs of every source with kind='twitter'. The X surface is isolated from the
// article feed: these IDs EXCLUDE tweets from article clustering (cluster-topics)
// and SELECT tweets for the dedicated tweet clustering (cluster-tweets). The set
// is tiny (dozens of accounts) and re-fetched once per job tick.
export async function twitterSourceIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("sources")
    .select("id")
    .eq("kind", "twitter");
  // THROW rather than return [] on error. A swallowed error here is dangerous:
  // cluster-topics would read an empty exclude-list and skip its tweet filter,
  // leaking tweets into the article feed. Callers must fail closed (abort the
  // run) instead of clustering everything. An empty array is only ever returned
  // when there genuinely are no twitter sources.
  if (error) {
    throw new Error(`twitterSourceIds: ${error.message}`);
  }
  return (data ?? []).map((r) => (r as { id: string }).id);
}

// PostgREST `in` filter value: "(id1,id2,...)". Returns null when the list is
// empty so callers skip the filter rather than emit "in.()", which matches
// nothing and would wrongly hide everything (cluster-topics) or everything-able
// (cluster-tweets).
export function pgInList(ids: readonly string[]): string | null {
  return ids.length ? `(${ids.join(",")})` : null;
}
