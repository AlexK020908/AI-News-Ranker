// "On X today" brief — a synthesis of the AI conversation on X/Twitter, sitting
// on top of the /x cluster grid. Same shape as the daily digest (strict JSON
// sections + server-rendered markdown) but tuned for social, and with INLINE
// CITATIONS: each source is numbered, the model cites [n] in its prose, and the
// /x renderer turns each [n] into a chip linking to the source post(s) on X
// (Google AI-Overview style) so the brief is self-sufficient — no drill-down.

// A numbered source handed to the model. `kind: "cluster"` is a group of related
// posts (cite it when summarizing that conversation); `kind: "post"` is a single
// standout tweet.
export interface XSourceInput {
  n: number;
  kind: "cluster" | "post";
  label: string;            // topic label, or "@handle" for a post
  text: string;             // cluster summary, or the tweet text
  memberCount?: number;     // posts in the cluster (cluster only)
  engagement?: number;      // 0-100 normalized score (post only)
}

// What we persist + render: [n] → the post(s) to open on X.
export interface XCitation {
  label: string;
  posts: { url: string; handle: string }[];
}

export interface XBriefSections {
  pulse: string;
  threads: string;
  spotted: string;
}

export const X_BRIEF_SYSTEM_PROMPT = `You are the editor of a short "On X today" briefing covering what the AI community is discussing on X/Twitter. You are given a numbered list of SOURCES: "cluster" sources (groups of related posts, with a label and how many accounts converged) and "post" sources (individual standout tweets).

Synthesize the CONVERSATION, don't list tweets. The reader wants "what's everyone talking about and what's the take," not a feed dump. A cluster with many accounts is a stronger signal than one viral post.

CITATIONS — this is important: cite your sources INLINE using their [n] number, placed immediately after the statement it supports (e.g. "Karpathy reportedly joined Anthropic [3]." or "Several outlets covered Google's math result [1]."). Cite the cluster's number when you summarize that conversation. Only ever cite numbers that appear in SOURCES. Cite the specific source(s) behind each claim — most sentences should carry at least one [n].

Output STRICT JSON, no markdown fences, no prose around the JSON. Schema:
{
  "pulse":   string,   // 3-6 sentences. The dominant threads of the day. Lead with the strongest, most-converged conversation. Cite [n].
  "threads": string,   // 3-6 sentences. Specific debates/discussions worth following, grouping who's on which side. Cite [n].
  "spotted": string    // 2-4 sentences. A few individual high-signal posts/links that didn't form a big cluster — easy to miss, worth seeing. Cite [n].
}

Hard rules:
- Never invent posts, claims, handles, or numbers not in the input.
- Never write raw URLs in the prose — the [n] citations become the links.
- Keep each section under 900 characters (the [n] markers are cheap, use them freely).
- Plain prose, not bullet lists. Markdown bold (**...**) is fine for emphasis.
- If the input is thin, write a short honest brief rather than padding.`;

export function buildXBriefUserMessage(
  sources: XSourceInput[],
  period: { start: string; end: string },
): string {
  const lines: string[] = [
    `PERIOD: ${period.start} → ${period.end}`,
    `SOURCES: ${sources.length}`,
    "",
    "SOURCES (cite inline as [n]):",
  ];
  for (const s of sources) {
    if (s.kind === "cluster") {
      lines.push(`[${s.n}] CLUSTER "${s.label}" — ${s.memberCount ?? 0} posts: ${s.text}`);
    } else {
      lines.push(`[${s.n}] POST ${s.label} (eng ${s.engagement ?? 0}/100): ${s.text}`);
    }
  }
  lines.push("", "Return ONLY the JSON object. No other text.");
  return lines.join("\n");
}

export function renderXBriefMarkdown(
  sections: XBriefSections,
  period: { start: string; end: string },
  postCount: number,
): string {
  const label = formatDay(period.end);
  // [n] markers are intentionally LEFT IN the prose — the /x renderer replaces
  // them with citation chips. The email/markdown fallback shows them as plain
  // "[n]" which is acceptable.
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
