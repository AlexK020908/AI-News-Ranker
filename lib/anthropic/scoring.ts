// Importance scoring — deterministic combiner.
//
// Why this file exists: Claude scoring a single 0-100 integer collapsed to
// rubric boundaries (every "solid paper" landed at 68 or 72). Splitting into
// four narrow ordinal axes lets Claude differentiate, and combining in code
// lets us mix in non-LLM signals (engagement, source trust, citations) that
// the model can't see at enrich time.

export const SUB_SCORE_AXES = ["novelty", "impact", "credibility", "actionability"] as const;
export type SubScoreAxis = (typeof SUB_SCORE_AXES)[number];

export type SubScores = Record<SubScoreAxis, number>;

export interface ImportanceSignals {
  // Already-normalized 0-100 row engagement (HN points, GH stars, HF likes,
  // tweet engagement). Default 0 — unknown signal = no bump.
  engagementScore?: number | null;
  // Source reputation_weight, 0-3 range. Default 1.0 (neutral).
  reputationWeight?: number | null;
  // Semantic Scholar influential-citation count; only meaningful for papers.
  influentialCitations?: number | null;
  // Gates the citation bump — bumping a tweet for "citations" is nonsense.
  isPaper?: boolean;
}

export interface CombineInput {
  subScores: SubScores;
  signals: ImportanceSignals;
}

// Clamp each axis to 1..5. Anything missing / out-of-band defaults to 3 (the
// neutral midpoint) so a single bad axis can't tank or inflate the score.
export function normalizeSubScores(raw: Partial<Record<SubScoreAxis, unknown>>): SubScores {
  const out = {} as SubScores;
  for (const axis of SUB_SCORE_AXES) {
    const v = raw[axis];
    const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 3;
    out[axis] = Math.max(1, Math.min(5, n));
  }
  return out;
}

export function combineImportance({ subScores, signals }: CombineInput): number {
  const raw =
    subScores.novelty +
    subScores.impact +
    subScores.credibility +
    subScores.actionability;
  // raw is 4..20; normalize to 0..100.
  const base = ((raw - 4) / 16) * 100;

  // Source reputation_weight is on 0..3 with 1.0 as the default. Map to a
  // 0.85..1.15 multiplier so a top-tier source nudges up ~15% and a low-rep
  // source nudges down ~15%. Nothing dramatic — keep Claude's call dominant.
  const repRaw = signals.reputationWeight;
  const rep = typeof repRaw === "number" && Number.isFinite(repRaw)
    ? Math.max(0, Math.min(3, repRaw))
    : 1.0;
  const mult = 0.85 + (rep / 3.0) * 0.30;

  // Engagement bump: 0..8 points additive. Capped so a viral HN post can't
  // promote a low-quality item past the breaking threshold on its own.
  const engRaw = signals.engagementScore;
  const eng = typeof engRaw === "number" && Number.isFinite(engRaw)
    ? Math.max(0, Math.min(100, engRaw))
    : 0;
  const engBump = (eng / 100) * 8;

  // Citation bump: paper-only, capped at 10 influential cites worth 0.8 each
  // (= 0..8). Bounded for the same reason as engagement.
  let citeBump = 0;
  if (signals.isPaper) {
    const cRaw = signals.influentialCitations;
    const c = typeof cRaw === "number" && Number.isFinite(cRaw) && cRaw > 0
      ? Math.min(10, Math.floor(cRaw))
      : 0;
    citeBump = c * 0.8;
  }

  const combined = base * mult + engBump + citeBump;
  return Math.max(0, Math.min(100, Math.round(combined)));
}
