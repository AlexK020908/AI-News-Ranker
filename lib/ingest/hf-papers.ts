import { truncate } from "@/lib/utils";
import type { Adapter } from "./types";
import { USER_AGENT } from "./types";
import { fetchJson, readNumberConfig } from "./http";
import { huggingfacePapersEngagement } from "./engagement";

// Shape of an entry from https://huggingface.co/api/daily_papers
//
// The endpoint is undocumented but stable — same shape as what the
// /papers page renders. Authors / submittedOnDailyBy / githubRepo are
// optional, so we narrow conservatively and treat each field as
// best-effort.
interface HFDailyEntry {
  numComments?: number;
  publishedAt?: string;
  submittedBy?: { name?: string; fullname?: string } | null;
  summary?: string;
  thumbnail?: string;
  title?: string;
  paper?: {
    id?: string;                  // arXiv ID (e.g. "2605.17602")
    title?: string;
    summary?: string;
    publishedAt?: string;
    submittedOnDailyAt?: string;
    upvotes?: number;
    githubRepo?: string;
    githubStars?: number;
    ai_keywords?: string[] | null;
    authors?: Array<{ name?: string }> | null;
  } | null;
}

function authorLine(entry: HFDailyEntry): string | null {
  const authors = entry.paper?.authors;
  if (!Array.isArray(authors) || authors.length === 0) return null;
  const names = authors
    .map((a) => a?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
  if (names.length === 0) return null;
  // Cap the author line at three names — papers with 20-author lists
  // would otherwise blow past the column width on cards.
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} et al.`;
}

export const hfPapersAdapter: Adapter = async (ctx) => {
  const max = readNumberConfig(ctx, "max_results", 50);
  const url = "https://huggingface.co/api/daily_papers";

  try {
    const data = await fetchJson<HFDailyEntry[]>(url, {
      headers: { accept: "application/json", "User-Agent": USER_AGENT },
    });
    const entries = (Array.isArray(data) ? data : []).slice(0, max);

    const items = entries
      .map((e) => {
        const arxivId = e.paper?.id?.trim();
        if (!arxivId) return null;
        const title = (e.paper?.title || e.title || "").trim();
        if (!title) return null;

        // Canonical URL is the HF curated page. It coexists with our
        // direct arXiv ingest (same paper, different URL) — embedding
        // similarity merges them at clustering time, and the HF entry's
        // upvote-based engagement_score gives the cluster a real signal
        // to rank on.
        const hfUrl = `https://huggingface.co/papers/${arxivId}`;
        const summary = (e.paper?.summary || e.summary || "").trim().replace(/\s+/g, " ");
        const upvotes = e.paper?.upvotes ?? 0;
        const comments = e.numComments ?? 0;
        const githubRepo = e.paper?.githubRepo || null;
        const githubStars = e.paper?.githubStars ?? null;

        return {
          external_id: `hfpaper:${arxivId}`,
          url: hfUrl,
          title: truncate(title, 500),
          author: authorLine(e),
          content: summary ? truncate(summary, 4000) : null,
          published_at: e.paper?.publishedAt || e.publishedAt || null,
          engagement_score: huggingfacePapersEngagement(upvotes, comments),
          thumbnail_candidate_url: e.thumbnail || null,
          raw: {
            arxiv_id: arxivId,
            upvotes,
            comments,
            submitted_on_daily_at: e.paper?.submittedOnDailyAt ?? null,
            github_repo: githubRepo,
            github_stars: githubStars,
            ai_keywords: e.paper?.ai_keywords ?? null,
            // Mirror the shape used by huggingface_models / arxiv adapters
            // so future ranking code can read a single canonical field.
            stars: githubStars ?? undefined,
          },
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);

    return { items };
  } catch (e) {
    return { items: [], error: `hf-papers: ${(e as Error).message}` };
  }
};
