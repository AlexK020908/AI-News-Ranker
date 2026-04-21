// Semantic Scholar enrichment for arXiv papers.
// Unauthenticated tier: ~100 req / 5 min. We call it at most once per paper,
// only after the item is >= 24h old (fresh papers have no citations yet).
//
// Docs: https://api.semanticscholar.org/graph/v1/paper/arXiv:{id}

const S2_BASE = "https://api.semanticscholar.org/graph/v1/paper";
const S2_FIELDS = "citationCount,influentialCitationCount,tldr";
const FRESH_HOURS = 24;

export interface PaperSignals {
  citations: number;
  influential_citations: number;
  tldr: string | null;
}

// Matches both http://arxiv.org/abs/2405.12345 and https://arxiv.org/pdf/… etc.
const ARXIV_RE = /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,6})(?:v\d+)?/i;

export function extractArxivId(url: string): string | null {
  const m = ARXIV_RE.exec(url);
  return m ? m[1] : null;
}

export function shouldFetchPaperSignals(publishedAt: string | null): boolean {
  if (!publishedAt) return false;
  const ageMs = Date.now() - new Date(publishedAt).getTime();
  return Number.isFinite(ageMs) && ageMs >= FRESH_HOURS * 3600 * 1000;
}

export async function fetchPaperSignals(
  arxivId: string,
  opts: { timeoutMs?: number } = {},
): Promise<PaperSignals | null> {
  const url = `${S2_BASE}/arXiv:${encodeURIComponent(arxivId)}?fields=${S2_FIELDS}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);

  const headers: Record<string, string> = { accept: "application/json" };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }

  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.status === 404) return null;
    if (res.status === 429) {
      // Rate-limited — surface null so enrichment doesn't block.
      return null;
    }
    if (!res.ok) return null;

    const data = (await res.json()) as {
      citationCount?: number;
      influentialCitationCount?: number;
      tldr?: { text?: string } | null;
    };

    return {
      citations: typeof data.citationCount === "number" ? data.citationCount : 0,
      influential_citations:
        typeof data.influentialCitationCount === "number"
          ? data.influentialCitationCount
          : 0,
      tldr: data.tldr?.text?.slice(0, 600) ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
