import type { SupabaseClient } from "@supabase/supabase-js";

// [n] → the post(s) to open on X for that inline citation.
export interface XBriefCitation {
  label: string;
  posts: { url: string; handle: string }[];
}

export interface XBrief {
  markdown: string;
  generated_at: string;
  // Keyed by the [n] markers in `markdown`. Null on older briefs.
  citations: Record<string, XBriefCitation> | null;
}

// The "On X today" synthesis rendered on /x. Latest row for surface='x',
// written by /api/jobs/x-brief. Display-only: returns null on any error/absence
// so the page shows its empty state rather than 500-ing.
export async function loadLatestXBrief(
  supabase: SupabaseClient,
): Promise<XBrief | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select("markdown, generated_at, citations")
    .eq("surface", "x")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("loadLatestXBrief:", error.message);
    return null;
  }
  return data ? (data as XBrief) : null;
}
