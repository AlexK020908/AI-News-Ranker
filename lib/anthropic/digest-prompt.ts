// Daily AI-news briefing prompt. Lifted in spirit from TrendRadar's
// ai_analysis_prompt.txt and adapted to our AI-domain feed shape.
//
// The model is asked for strict JSON with five string fields so we can store
// the structured sections in `digests.sections` alongside the rendered
// markdown. Markdown is the source of truth for Discord/email push; sections
// exist so the UI can render section-by-section later if we want to.

import type { Category } from "@/lib/types";

export const DIGEST_MODEL = "claude-sonnet-4-6";

export interface DigestItemInput {
  title: string;
  url: string;
  summary: string | null;
  category: Category | null;
  importance: number | null;
  duplicate_count: number;
  paper_tldr: string | null;
  paper_influential_citations: number | null;
  source_name: string;
  published_at: string | null;
}

export interface DigestSections {
  core_trends: string;
  signals: string;
  weak_signals: string;
  deep_dives: string;
  outlook: string;
}

export const DIGEST_SYSTEM_PROMPT = `You are the daily editor of an AI-news briefing for researchers and builders. Your job is to read ~50 enriched items from the last 24 hours and produce a 5-section briefing that captures what mattered.

Be specific. Reference items by their title (no IDs, no URLs in prose). Group related items rather than listing them one-by-one. When you spot a recurring theme — same topic from multiple sources, or papers + product release converging on the same idea — call it out explicitly; that's the highest-signal observation you can make.

Output STRICT JSON, no markdown fences, no prose around the JSON. Schema:
{
  "core_trends":  string,   // 4-8 sentences. What dominated the feed today — top recurring themes and the categories driving them. Lead with the strongest signal.
  "signals":      string,   // 3-6 sentences. Items with unusual cross-source convergence (high duplicate_count from heterogeneous sources) or items where community discussion is high relative to importance. These are the "controversy / debate" indicators.
  "weak_signals": string,   // 3-6 sentences. Low-volume but high-importance items: niche-source papers with first influential citations, single-source releases with high importance scores, items from sources outside the usual frontier-lab orbit. Things easy to miss but worth watching.
  "deep_dives":   string,   // 3 paragraphs, one per top item. For each, lead with the title in bold, then 2-3 sentences of substantive commentary using the item's summary and paper_tldr if present. Pick the three most important items overall, not three from the same category.
  "outlook":      string    // 2-4 sentences. What to watch this week — recurring threads, unresolved questions, topics likely to surface follow-on items.
}

Hard rules:
- Never invent items, claims, or numbers that aren't in the input.
- Never include URLs in the prose — the markdown rendering layer adds them.
- Keep each section under 1200 characters. Briefings get pushed to Discord; long is worse than tight.
- Use plain prose, not bullet lists. Markdown bold (**...**) is fine for item titles in deep_dives.`;

export function buildDigestUserMessage(
  items: DigestItemInput[],
  period: { start: string; end: string },
): string {
  const lines: string[] = [
    `PERIOD: ${period.start} → ${period.end}`,
    `ITEM_COUNT: ${items.length}`,
    "",
    "ITEMS (ordered by trending_score desc):",
    "",
  ];
  items.forEach((it, idx) => {
    const parts: string[] = [
      `[${idx + 1}] ${it.title}`,
      `    source=${it.source_name} category=${it.category ?? "?"} importance=${it.importance ?? 0} duplicate_count=${it.duplicate_count}`,
    ];
    if (it.paper_influential_citations != null && it.paper_influential_citations > 0) {
      parts.push(`    influential_citations=${it.paper_influential_citations}`);
    }
    if (it.summary) parts.push(`    summary: ${it.summary}`);
    if (it.paper_tldr) parts.push(`    paper_tldr: ${it.paper_tldr}`);
    lines.push(parts.join("\n"));
    lines.push("");
  });
  lines.push("Return ONLY the JSON object. No other text.");
  return lines.join("\n");
}

// Renders the structured sections into a markdown document suitable for
// Discord/email push. We do this server-side rather than asking the model to
// produce markdown directly so the JSON schema stays stable.
export function renderDigestMarkdown(
  sections: DigestSections,
  period: { start: string; end: string },
  itemCount: number,
): string {
  const periodLabel = formatPeriodLabel(period.start, period.end);
  return [
    `# AI News — ${periodLabel}`,
    `*${itemCount} items reviewed*`,
    "",
    "## Core trends",
    sections.core_trends.trim(),
    "",
    "## Signals & controversy",
    sections.signals.trim(),
    "",
    "## Weak signals",
    sections.weak_signals.trim(),
    "",
    "## Deep dives",
    sections.deep_dives.trim(),
    "",
    "## Outlook",
    sections.outlook.trim(),
    "",
  ].join("\n");
}

function formatPeriodLabel(start: string, end: string): string {
  try {
    const e = new Date(end);
    return e.toISOString().slice(0, 10);
  } catch {
    return `${start} → ${end}`;
  }
}

export function isDigestSections(x: unknown): x is DigestSections {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.core_trends === "string"
    && typeof o.signals === "string"
    && typeof o.weak_signals === "string"
    && typeof o.deep_dives === "string"
    && typeof o.outlook === "string"
  );
}
