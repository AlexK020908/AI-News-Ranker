import { ENRICHMENT_MODEL, getAnthropic } from "./client";
import {
  buildEnrichmentUserMessage,
  ENRICHMENT_SYSTEM_PROMPT,
  type EnrichmentOutput,
} from "./prompts";
import { CATEGORIES, type Category } from "@/lib/types";
import { extractJsonBlock } from "@/lib/utils";
import { normalizeSubScores, normalizeTier, type ImportanceTier, type SubScores } from "./scoring";

export interface EnrichInput {
  sourceName: string;
  sourceKind: string;
  title: string;
  url: string;
  author?: string | null;
  content?: string | null;
  publishedAt?: string | null;
}

export interface EnrichResult {
  summary: string;
  category: Category;
  tags: string[];
  // Coarse importance class from Claude — the backbone of the 0-100 importance
  // computed downstream. Always a valid tier (normalizeTier fills a default).
  tier: ImportanceTier;
  // Raw 1-5 ordinal axis ratings from Claude. The final 0-100 importance is
  // computed in the enrich route by combineImportance() because it needs row
  // signals (engagement_score, source.reputation_weight, paper citations)
  // that aren't visible inside enrichItem.
  subScores: SubScores;
  // Plain-English paper explanation. Only populated when Claude returned
  // a non-empty caveman_summary AND the category resolved to "paper".
  caveman_summary: string | null;
  raw: EnrichmentOutput;
}

export async function enrichItem(input: EnrichInput): Promise<EnrichResult> {
  const anthropic = getAnthropic();
  const response = await anthropic.messages.create({
    model: ENRICHMENT_MODEL,
    max_tokens: 500,
    system: [
      {
        type: "text",
        text: ENRICHMENT_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: buildEnrichmentUserMessage(input),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Anthropic response had no text block");
  }
  const parsed = parseEnrichmentJSON(textBlock.text);
  const category = normalizeCategory(parsed.category);
  const cavemanRaw = typeof parsed.caveman_summary === "string"
    ? parsed.caveman_summary.trim()
    : "";
  const subScores = normalizeSubScores({
    novelty: parsed.novelty,
    impact: parsed.impact,
    credibility: parsed.credibility,
    actionability: parsed.actionability,
  });
  return {
    summary: parsed.summary,
    category,
    tags: normalizeTags(parsed.tags),
    tier: normalizeTier(parsed.tier, subScores),
    subScores,
    caveman_summary: category === "paper" && cavemanRaw.length > 0
      ? cavemanRaw.slice(0, 320)
      : null,
    raw: parsed,
  };
}

function parseEnrichmentJSON(text: string): EnrichmentOutput {
  const block = extractJsonBlock(text);
  if (!block) throw new Error("no JSON body");
  const obj = JSON.parse(block);
  if (typeof obj.summary !== "string") throw new Error("summary missing");
  if (typeof obj.category !== "string") throw new Error("category missing");
  if (!Array.isArray(obj.tags)) throw new Error("tags missing");
  // Sub-scores are soft-validated downstream in normalizeSubScores — a single
  // missing axis defaults to 3 rather than failing the whole enrichment.
  return obj as EnrichmentOutput;
}

function normalizeCategory(c: string): Category {
  const lower = c.toLowerCase().trim() as Category;
  return (CATEGORIES as readonly string[]).includes(lower) ? lower : "other";
}

function normalizeTags(tags: unknown[]): string[] {
  return tags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.toLowerCase().trim().replace(/\s+/g, "-"))
    .filter((t) => t.length > 0 && t.length <= 32)
    .slice(0, 5);
}
