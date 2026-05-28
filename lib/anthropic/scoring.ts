// Importance scoring — deterministic combiner.
//
// Why this file exists, and the v2 redesign:
//
// v1 had Claude emit a single 0-100 importance integer. It collapsed to rubric
// boundaries (every "solid paper" landed at 68 or 72) and drifted run-to-run.
// Splitting into four 1-5 ordinal axes helped, but the *magnitude* of the score
// was still ~80% a raw LLM number scored in isolation — exactly the thing LLMs
// are bad at (no cross-item anchor, poor calibration, run-to-run variance).
//
// v2 makes the LLM do what it's reliable at — a coarse, well-anchored
// CLASSIFICATION (the `tier`) — and uses the four axes only to refine the score
// WITHIN that tier's band. So the precise LLM numbers can move an item by at
// most ±a half-band, not across the whole 0-100 range. Real, observable signals
// the model can't see at scoring time (engagement, paper citations, source
// trust) then adjust the result. Cross-source corroboration is intentionally
// NOT folded in here — an item is scored in isolation before clustering, so
// corroboration lives in the trending layer (trending_items / topicTrending),
// which is also the documented anti-manipulation signal (see lib/stories.ts).

export const SUB_SCORE_AXES = ["novelty", "impact", "credibility", "actionability"] as const;
export type SubScoreAxis = (typeof SUB_SCORE_AXES)[number];

export type SubScores = Record<SubScoreAxis, number>;

// Coarse importance class. LLMs are reliable at 4-way classification with
// anchored definitions; this is the backbone of the score. See the TIER block
// in lib/anthropic/prompts.ts for the rubric Claude is given.
export const IMPORTANCE_TIERS = ["breaking", "notable", "routine", "minor"] as const;
export type ImportanceTier = (typeof IMPORTANCE_TIERS)[number];

// Each tier owns a band of the 0-100 scale: an anchor (band center) and a
// half-width the axes can push within. Bands are deliberately adjacent with a
// little overlap so a top-of-band "notable" can edge out a weak "breaking"
// once real signals are added — the tier is a strong prior, not a hard gate.
const TIER_ANCHOR: Record<ImportanceTier, number> = {
  breaking: 82,
  notable: 60,
  routine: 38,
  minor: 16,
};
const TIER_HALF_BAND: Record<ImportanceTier, number> = {
  breaking: 14,
  notable: 14,
  routine: 14,
  minor: 12,
};

// Importance gates used across the app, derived from the bands above and
// centralized here so they stay in sync when the bands move. With these
// anchors a typical item lands at base = anchor + (axisMean-3)/2 * halfBand,
// then × reputation mult (0.9–1.1) + engagement (0–16) + citations (0–12):
//   breaking band ≈ 68–96 base   → real breaking items clear ~88 after signals
//   notable  band ≈ 46–74 base   → "good" items clear ~55
// Retune ONLY here if TIER_ANCHOR / TIER_HALF_BAND change.
//
// "this is breaking" UI flag + push-worthy. Below the breaking band ceiling so
// a genuine breaking item with strong (not maxed) axes still trips it.
export const BREAKING_IMPORTANCE = 88;
// Default floor for webhook/email subscriptions: strong-notable and up.
export const WEBHOOK_DEFAULT_MIN_IMPORTANCE = 70;
// Daily digest floor: notable tier and up ("genuinely good items").
export const DIGEST_MIN_IMPORTANCE = 55;
// A member this important joining a cluster is worth re-labeling for.
export const HIGH_IMPACT_MEMBER_IMPORTANCE = 75;

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
  // Coarse importance class from Claude. Optional only for defensive callers;
  // enrichItem always supplies one (normalizeTier fills a sane default).
  tier?: ImportanceTier;
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

// Resolve Claude's tier string to a valid ImportanceTier. When Claude omits it
// or returns garbage, infer a tier from the axis mean so the score still has a
// sensible backbone rather than silently defaulting everything to one band.
export function normalizeTier(raw: unknown, subScores: SubScores): ImportanceTier {
  if (typeof raw === "string") {
    const lower = raw.toLowerCase().trim();
    if ((IMPORTANCE_TIERS as readonly string[]).includes(lower)) {
      return lower as ImportanceTier;
    }
  }
  const mean = axisMean(subScores);
  if (mean >= 4.25) return "breaking";
  if (mean >= 3.25) return "notable";
  if (mean >= 2.0) return "routine";
  return "minor";
}

function axisMean(s: SubScores): number {
  return (s.novelty + s.impact + s.credibility + s.actionability) / 4;
}

export function combineImportance({ tier, subScores, signals }: CombineInput): number {
  const resolvedTier = tier ?? normalizeTier(undefined, subScores);

  // Backbone: the tier band, refined by the axes. axisMean is 1..5 with 3
  // neutral; map (mean-3)/2 ∈ [-1,1] and scale by the band half-width. A
  // "notable" item with all-5 axes lands at the top of the notable band; with
  // all-1 axes, the bottom. The full-range LLM number is gone — the model's
  // fine-grained opinion only moves the score within its tier.
  const anchor = TIER_ANCHOR[resolvedTier];
  const halfBand = TIER_HALF_BAND[resolvedTier];
  const axisOffset = ((axisMean(subScores) - 3) / 2) * halfBand;
  const base = anchor + axisOffset;

  // Source reputation_weight is on 0..3 with 1.0 as the default. Gentle
  // multiplier (0.9..1.1) — gentler than v1 since the tier now carries the
  // judgment; reputation should nudge, not dominate.
  const repRaw = signals.reputationWeight;
  const rep = typeof repRaw === "number" && Number.isFinite(repRaw)
    ? Math.max(0, Math.min(3, repRaw))
    : 1.0;
  const mult = 0.9 + (rep / 3.0) * 0.20;

  // Engagement bump: 0..16 additive (widened from v1's 8). Real audience
  // reaction is a trustworthy signal the model can't see, so let it pull
  // harder — but still capped so a viral-but-shallow post can't vault a
  // whole tier on engagement alone.
  const engRaw = signals.engagementScore;
  const eng = typeof engRaw === "number" && Number.isFinite(engRaw)
    ? Math.max(0, Math.min(100, engRaw))
    : 0;
  const engBump = (eng / 100) * 16;

  // Citation bump: paper-only, 0..12 (widened from v1's 8). Influential
  // citations are the academic analogue of corroboration — strong evidence a
  // paper mattered, invisible to the model at enrich time.
  let citeBump = 0;
  if (signals.isPaper) {
    const cRaw = signals.influentialCitations;
    const c = typeof cRaw === "number" && Number.isFinite(cRaw) && cRaw > 0
      ? Math.min(10, Math.floor(cRaw))
      : 0;
    citeBump = c * 1.2;
  }

  const combined = base * mult + engBump + citeBump;
  return Math.max(0, Math.min(100, Math.round(combined)));
}
