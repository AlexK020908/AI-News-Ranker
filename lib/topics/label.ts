import { ENRICHMENT_MODEL, getAnthropic } from "@/lib/anthropic/client";
import { extractJsonBlock } from "@/lib/utils";

// Prompt-cached: the instructions don't change across clusters, so Anthropic
// returns the TTFT win on every call after the first.
const LABELING_SYSTEM_PROMPT = `You label clusters of AI news items for a trending-topics UI.

For a given cluster of related items (titles + summaries), output STRICT JSON:
{
  "label":   string,   // 2-5 words, Title Case. The concept binding these items. NOT a sentence. NOT a marketing phrase. Examples: "Reasoning Models", "Open-Source Agents", "Mamba Variants", "AI Funding — Late Stage", "Multimodal Robotics".
  "summary": string    // ONE sentence, <=180 chars, stating what's happening in this cluster. Specific, not generic. Example: "Three labs released open-weight reasoning models this week with competitive MATH and GPQA scores."
}

Rules:
- Find what's ACTUALLY shared. If 5 items about different reasoning models: label is "Reasoning Models", not "New AI Releases".
- If the items are all funding rounds, prefer "<Sector> Funding" over generic "Funding".
- If the cluster is incoherent (items don't share a real theme), output {"label": "SKIP", "summary": ""}.
- Never use "AI", "LLM", or "Machine Learning" alone as the entire label — too generic.
- Never include source names, URLs, dates, or item counts.
- Never wrap the JSON in markdown fences.`;

export interface TopicLabel {
  label: string;
  summary: string;
}

export interface LabelInput {
  titles: string[];    // cluster member titles
  summaries: string[]; // cluster member summaries (same indexing as titles)
}

export async function labelCluster(input: LabelInput): Promise<TopicLabel | null> {
  const anthropic = getAnthropic();

  const lines: string[] = [];
  for (let i = 0; i < Math.min(input.titles.length, 12); i++) {
    const t = input.titles[i]?.slice(0, 200) ?? "";
    const s = input.summaries[i]?.slice(0, 240) ?? "";
    lines.push(`- ${t}${s ? `\n  ${s}` : ""}`);
  }

  const userMsg = `Cluster of ${input.titles.length} items:\n\n${lines.join(
    "\n",
  )}\n\nReturn ONLY the JSON object.`;

  const response = await anthropic.messages.create({
    model: ENRICHMENT_MODEL,
    max_tokens: 200,
    system: [
      {
        type: "text",
        text: LABELING_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return null;

  const parsed = parseJson(textBlock.text);
  if (!parsed) return null;
  if (parsed.label === "SKIP" || !parsed.label) return null;

  return {
    label: parsed.label.slice(0, 80),
    summary: (parsed.summary ?? "").slice(0, 240),
  };
}

function parseJson(text: string): { label?: string; summary?: string } | null {
  const block = extractJsonBlock(text);
  if (!block) return null;
  try {
    return JSON.parse(block);
  } catch {
    return null;
  }
}

export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
