// "On X today" brief — a synthesis of the AI conversation on X/Twitter, sitting
// on top of the /x cluster grid. Same shape as the daily digest (strict JSON
// sections + server-rendered markdown) but tuned for social: the value is the
// synthesis of the conversation, not individual low-signal posts.

export const X_BRIEF_MODEL = "claude-sonnet-4-6";

export interface XTweetInput {
  handle: string;        // author, e.g. "@karpathy"
  text: string;         // tweet text (already trimmed/truncated)
  importance: number | null;
  engagement: number;   // likes + reposts + replies, coarse
}

export interface XClusterInput {
  label: string;        // x_topic label
  summary: string | null;
  member_count: number; // how many tweets converged here
}

export interface XBriefSections {
  pulse: string;
  threads: string;
  spotted: string;
}

export const X_BRIEF_SYSTEM_PROMPT = `You are the editor of a short "On X today" briefing covering what the AI community is discussing on X/Twitter. You are given (a) clustered conversations — groups of related posts with a label and how many accounts converged on them — and (b) the day's highest-engagement individual posts.

Synthesize the CONVERSATION, don't list tweets. The reader wants "what's everyone talking about and what's the take," not a feed dump. Attribute by handle where it sharpens the point (e.g. "@karpathy argued…"). A cluster with many accounts is a stronger signal than one viral post.

Output STRICT JSON, no markdown fences, no prose around the JSON. Schema:
{
  "pulse":   string,   // 3-6 sentences. The dominant threads of the day — what most of AI-X was reacting to. Lead with the strongest, most-converged conversation.
  "threads": string,   // 3-6 sentences. Specific debates/discussions worth following, grouping who's on which side. These are the "there's an actual argument here" items.
  "spotted": string    // 2-4 sentences. A few individual high-signal posts or links worth a click that didn't form a big cluster — easy to miss, worth seeing.
}

Hard rules:
- Never invent posts, claims, handles, or numbers not in the input.
- Never include URLs in the prose.
- Keep each section under 900 characters. Tight beats long.
- Plain prose, not bullet lists. Markdown bold (**...**) is fine for emphasis on a handle or topic.
- If the input is thin (few posts, no clusters), write a short honest brief rather than padding.`;

export function buildXBriefUserMessage(
  clusters: XClusterInput[],
  tweets: XTweetInput[],
  period: { start: string; end: string },
): string {
  const lines: string[] = [
    `PERIOD: ${period.start} → ${period.end}`,
    `CLUSTERS: ${clusters.length}  POSTS: ${tweets.length}`,
    "",
    "CLUSTERED CONVERSATIONS (label — how many accounts converged):",
  ];
  if (clusters.length === 0) {
    lines.push("  (none yet — not enough related posts to cluster)");
  } else {
    clusters.forEach((c) => {
      lines.push(
        `  - ${c.label} [${c.member_count} posts]${c.summary ? `: ${c.summary}` : ""}`,
      );
    });
  }
  lines.push("", "TOP POSTS (by engagement):", "");
  tweets.forEach((t, idx) => {
    lines.push(
      `[${idx + 1}] ${t.handle} (eng=${t.engagement}, importance=${t.importance ?? 0})\n    ${t.text}`,
    );
  });
  lines.push("", "Return ONLY the JSON object. No other text.");
  return lines.join("\n");
}

export function renderXBriefMarkdown(
  sections: XBriefSections,
  period: { start: string; end: string },
  postCount: number,
): string {
  const label = formatDay(period.end);
  return [
    `# On X — ${label}`,
    `*${postCount} posts reviewed*`,
    "",
    "## The pulse",
    sections.pulse.trim(),
    "",
    "## Threads",
    sections.threads.trim(),
    "",
    "## Spotted",
    sections.spotted.trim(),
    "",
  ].join("\n");
}

function formatDay(end: string): string {
  try {
    return new Date(end).toISOString().slice(0, 10);
  } catch {
    return end;
  }
}

export function isXBriefSections(x: unknown): x is XBriefSections {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.pulse === "string"
    && typeof o.threads === "string"
    && typeof o.spotted === "string"
  );
}
