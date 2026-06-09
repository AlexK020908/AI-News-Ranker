// Front-page listwise re-rank (Stage 3 of the ranking redesign).
//
// Instead of asking the model to SCORE each story in isolation (poorly
// calibrated, drifts run-to-run), we hand it the day's top stories together and
// ask it to ORDER them relative to each other — a comparative judgment LLMs are
// far more reliable at. The job (app/api/jobs/rerank) maps the returned order
// onto topics.rerank_rank.

import { chatText, RERANK_MODEL } from "@/lib/llm/chat";

const RERANK_SYSTEM_PROMPT = `You are the editor of a frontier-AI news homepage for researchers and builders. You are given a numbered list of today's candidate stories. Your job is to ORDER them by genuine importance to that audience — most important first.

What "important" means here:
- Real significance: frontier model launches, genuine capability breakthroughs, landmark research, major funding/M&A, consequential policy or safety developments.
- Corroboration is strong evidence: a story covered by MANY independent outlets (high "sources" count) is more likely to matter than a single-outlet item. You cannot bot independent reputable publishers into covering the same thing.
- The list is already in current trending order, which is recency-weighted — so a story's position is a prior that bakes in freshness. Treat it as a starting point you can override on the merits, not as ground truth.

Downweight: rehashes and explainers of known material, marketing/PR with no substance, listicles, and narrow vendor minutiae — even if they currently sit near the top.

You are RE-ORDERING, so use the whole list as context: judge each story against the others, not against an absolute bar.

Output STRICT JSON — no prose, no markdown fences — an array of every story's number exactly once, ordered most-important first:
{"order": [12, 3, 27, 1, ...]}

The array MUST be a permutation of the input numbers: include each number exactly once, add none that weren't given.`;

export interface RerankCandidate {
  ref: number; // 1-based stable handle, assigned by the caller
  label: string;
  summary: string | null;
  memberCount: number; // cross-source corroboration
  maxImportance: number | null;
}

// Returns the candidate refs in the model's importance order — guaranteed to be
// a permutation of the input refs (any refs the model dropped are appended in
// their original order; anything bogus is discarded). Returns null only when
// the call/parse fails entirely, so the caller can skip the rerank cleanly.
export async function rerankTopics(
  candidates: RerankCandidate[],
): Promise<number[] | null> {
  if (candidates.length === 0) return [];

  const lines = candidates.map((c) => {
    const summary = (c.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
    return `[${c.ref}] ${c.label} (sources: ${c.memberCount}, score: ${c.maxImportance ?? "?"})\n    ${summary}`;
  });

  const userMsg = `These ${candidates.length} stories are listed in current trending order. Re-order them by importance (most important first). Return ONLY the JSON object.\n\n${lines.join("\n")}`;

  let text: string;
  try {
    text = await chatText({
      system: RERANK_SYSTEM_PROMPT,
      user: userMsg,
      model: RERANK_MODEL,
      maxTokens: 2000,
    });
  } catch (e) {
    console.error("rerankTopics call failed:", (e as Error).message);
    return null;
  }

  const parsed = parseOrder(text);
  if (!parsed) return null;

  return repairPermutation(parsed, candidates.map((c) => c.ref));
}

// Accept either {"order":[...]} (what we ask for) OR a bare [...] array (a
// common LLM deviation). The shared extractJsonBlock only handles {...}, so we
// can't use it — a bare array would slip through as null. Strip code fences,
// then try the object slice and the array slice and take whichever parses to a
// usable list of integers.
function parseOrder(text: string): number[] | null {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  const slices: string[] = [];
  const ob = t.indexOf("{");
  const cb = t.lastIndexOf("}");
  if (ob !== -1 && cb > ob) slices.push(t.slice(ob, cb + 1));
  const oa = t.indexOf("[");
  const ca = t.lastIndexOf("]");
  if (oa !== -1 && ca > oa) slices.push(t.slice(oa, ca + 1));
  for (const slice of slices) {
    try {
      const obj = JSON.parse(slice);
      const arr = Array.isArray(obj) ? obj : obj?.order;
      if (!Array.isArray(arr)) continue;
      const nums = arr
        .map((v) => (typeof v === "number" ? v : Number(v)))
        .filter((n) => Number.isInteger(n));
      if (nums.length > 0) return nums;
    } catch {
      // try the next slice
    }
  }
  return null;
}

// Coerce the model's output into a true permutation of validRefs: keep the
// model's order for refs it returned (de-duped, bogus refs dropped), then
// append any refs it omitted in their original order so nothing vanishes.
function repairPermutation(order: number[], validRefs: number[]): number[] {
  const valid = new Set(validRefs);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of order) {
    if (valid.has(n) && !seen.has(n)) {
      out.push(n);
      seen.add(n);
    }
  }
  for (const ref of validRefs) {
    if (!seen.has(ref)) out.push(ref);
  }
  return out;
}
