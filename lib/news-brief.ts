import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewsBriefSections } from "@/lib/anthropic/news-brief-prompt";

// [n] → the source to open for that topic. Same shape as the X citation map so
// the /brief page can reuse the citation chip unchanged.
export interface NewsBriefCitation {
  label: string;
  posts: { url: string; handle: string }[];
}

export interface NewsBrief {
  sections: NewsBriefSections | null;
  generated_at: string;
  citations: Record<string, NewsBriefCitation> | null;
}

// The "What's going on in AI Space" brief rendered on /brief. Latest row for
// surface='news', written by /api/jobs/news-brief. Display-only: returns null
// on any error/absence so the page shows its empty state rather than 500-ing.
export async function loadLatestNewsBrief(
  supabase: SupabaseClient,
): Promise<NewsBrief | null> {
  const { data, error } = await supabase
    .from("briefs")
    .select("sections, generated_at, citations")
    .eq("surface", "news")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("loadLatestNewsBrief:", error.message);
    return null;
  }
  return data ? (data as NewsBrief) : null;
}
