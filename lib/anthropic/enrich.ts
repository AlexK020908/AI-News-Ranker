import { ENRICHMENT_MODEL, getAnthropic } from "./client";
import {
  buildEnrichmentUserMessage,
  ENRICHMENT_SYSTEM_PROMPT,
  type EnrichmentOutput,
} from "./prompts";
import { CATEGORIES, type Category } from "@/lib/types";
import { extractJsonBlock } from "@/lib/utils";

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
  importance: number;
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
  return {
    summary: parsed.summary,
    category: normalizeCategory(parsed.category),
    tags: normalizeTags(parsed.tags),
    importance: clampImportance(parsed.importance),
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
  if (typeof obj.importance !== "number") throw new Error("importance missing");
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

function clampImportance(n: number): number {
  const i = Math.round(n);
  if (Number.isNaN(i)) return 30;
  return Math.max(0, Math.min(100, i));
}
