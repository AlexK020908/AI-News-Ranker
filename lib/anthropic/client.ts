import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  _client = new Anthropic({ apiKey: key });
  return _client;
}

export const ENRICHMENT_MODEL = "claude-haiku-4-5-20251001";

// The front-page listwise re-rank (app/api/jobs/rerank) is a comparative
// reasoning task over ~40 stories at once — worth a stronger model than the
// per-item enrichment. Sonnet 4.6 balances judgment quality against the cost
// of a single call per rerank pass.
export const RERANK_MODEL = "claude-sonnet-4-6";
