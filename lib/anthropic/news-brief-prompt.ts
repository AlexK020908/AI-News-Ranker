// "What's going on in AI Space" brief — the news/funding/releases counterpart
// to the X brief (lib/anthropic/x-brief-prompt.ts). Same machinery (strict JSON
// + server-rendered markdown + inline [n] citations) but the output is a RANKED
// list of topics — a headline title plus a few bullet points each — ordered by
// importance, rather than prose sections. This is the shape the daily email
// leads with ("just tell me what happened"), and it also drives the /brief page.

import type { Category } from "@/lib/types";

export const NEWS_BRIEF_MODEL = "claude-sonnet-4-6";

// A numbered candidate item handed to the model. `n` is the citation marker.
export interface NewsItemInput {
  n: number;
  title: string;
  summary: string | null;
  category: Category | null;
  importance: number | null;
  duplicate_count: number;
  source_name: string;
  paper_tldr?: string | null;
}

// [n] → the source to open for that topic. Mirrors XCitation's shape (label +
// posts[]) so the /brief renderer can reuse the X citation chip unchanged.
export interface NewsCitation {
  label: string;
  posts: { url: string; handle: string }[];
}

export interface NewsBriefTopic {
  title: string;       // the headline, e.g. "Anthropic files confidential S-1"
  bullets: string[];   // 1-4 short factual points — what actually happened
  cite: number;        // [n] of the primary source item
}

export interface NewsBriefSections {
  topics: NewsBriefTopic[];
}

export const NEWS_BRIEF_SYSTEM_PROMPT = `You are the editor of a daily "What's going on in AI" briefing for builders and researchers. You are given a numbered list of SOURCES — the day's most important AI items (releases, funding, research, product, policy), each with a title, source, category, importance score, and how many independent sources corroborated it.

Produce a RANKED list of the day's TOPICS. Each topic is a sharp headline plus a few bullet points stating what actually happened — facts, numbers, names. Group items that are about the same story into ONE topic. Order topics by importance (most important first); use the importance scores and corroboration count as your guide, not the input order.

Write for someone who wants the gist fast: tight, concrete, no hype, no preamble. A bullet is one short line ("2.5× faster inference and stronger reasoning", "raised $300M Series C led by ...").

CITATIONS: each topic must cite the [n] of its primary source item (the "cite" field). Only ever use a number that appears in SOURCES.

Output STRICT JSON, no markdown fences, no prose around the JSON. Schema:
{
  "topics": [
    {
      "title":   string,        // <= ~70 chars, headline style, no trailing period
      "bullets": [string, ...], // 1-4 bullets, each a short concrete line
      "cite":    number         // [n] of the primary source
    }
  ]
}

Hard rules:
- Never invent items, claims, numbers, or names not in the input.
- Pick the 5-9 most important distinct topics. Drop filler — fewer strong topics beats a long thin list.
- No URLs in titles or bullets — the [n] citation becomes the link.
- Keep bullets to one line each; bold is unnecessary (the title is already emphasized).`;

export function buildNewsBriefUserMessage(
  items: NewsItemInput[],
  period: { start: string; end: string },
): string {
  const lines: string[] = [
    `PERIOD: ${period.start} → ${period.end}`,
    `SOURCES: ${items.length}`,
    "",
    "SOURCES (cite each topic's primary source as [n]):",
    "",
  ];
  for (const it of items) {
    const parts: string[] = [
      `[${it.n}] ${it.title}`,
      `    source=${it.source_name} category=${it.category ?? "?"} importance=${it.importance ?? 0} corroboration=${it.duplicate_count}`,
    ];
    if (it.summary) parts.push(`    summary: ${it.summary}`);
    if (it.paper_tldr) parts.push(`    paper_tldr: ${it.paper_tldr}`);
    lines.push(parts.join("\n"));
  }
  lines.push("", "Return ONLY the JSON object. No other text.");
  return lines.join("\n");
}

// Server-rendered markdown fallback (digests.markdown + Discord push). The [n]
// markers are intentionally kept in the text — the /brief renderer and email
// turn them into links; plain markdown shows a bare "[n]", which is acceptable.
export function renderNewsBriefMarkdown(
  sections: NewsBriefSections,
  period: { start: string; end: string },
): string {
  const out: string[] = [
    `# What's going on in AI Space — ${formatDay(period.end)}`,
    `*${sections.topics.length} stories*`,
    "",
  ];
  sections.topics.forEach((t, i) => {
    out.push(`${i + 1}. **${t.title}** [${t.cite}]`);
    for (const b of t.bullets) out.push(`   - ${b}`);
  });
  out.push("");
  return out.join("\n");
}

function formatDay(end: string): string {
  try {
    return new Date(end).toISOString().slice(0, 10);
  } catch {
    return end;
  }
}

export function isNewsBriefSections(x: unknown): x is NewsBriefSections {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o.topics)) return false;
  return o.topics.every((t) => {
    if (!t || typeof t !== "object") return false;
    const r = t as Record<string, unknown>;
    return (
      typeof r.title === "string"
      && typeof r.cite === "number"
      && Array.isArray(r.bullets)
      && r.bullets.every((b) => typeof b === "string")
    );
  });
}
