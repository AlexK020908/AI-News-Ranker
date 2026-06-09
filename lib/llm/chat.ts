// Provider-agnostic single-shot chat, used by the enrichment, cluster-labeling,
// rerank, and brief jobs. Every one of those call sites is the same shape — a
// fixed system prompt + one user message, expecting a JSON body back — so they
// all funnel through chatText() here.
//
// The provider is chosen by LLM_PROVIDER (default "gemini"). Gemini, OpenAI, and
// DeepSeek are reached over their OpenAI-compatible /chat/completions endpoint
// via plain fetch (no SDK, so nothing new to bundle into the standalone build);
// "anthropic" falls back to the Anthropic SDK so the original behavior is one
// env var away.
//
// Why Gemini Flash-Lite by default: per-item enrichment is ~80-90% of the LLM
// bill and is pure structured extraction (summary/tags/category/1-5 axis
// scores), which a cheap model handles fine — ~10x cheaper than Claude Haiku.

import { getAnthropic } from "@/lib/anthropic/client";

export type LlmProvider = "openrouter" | "gemini" | "openai" | "deepseek" | "anthropic";

export interface ChatOpts {
  system: string;
  user: string;
  model: string;
  maxTokens: number;
  // Defaults to 0.3 — these are extraction/judgment tasks, not creative ones.
  temperature?: number;
}

function resolveProvider(): LlmProvider {
  const raw = process.env.LLM_PROVIDER?.toLowerCase();
  if (
    raw === "openrouter" || raw === "openai" || raw === "deepseek" ||
    raw === "anthropic" || raw === "gemini"
  ) {
    return raw;
  }
  return "openrouter";
}

export const LLM_PROVIDER: LlmProvider = resolveProvider();

// OpenAI-compatible chat-completions base URLs. Anthropic is handled by its own
// SDK below, not through here.
const OPENAI_COMPAT_BASE: Partial<Record<LlmProvider, string>> = {
  openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
};

function envNameFor(provider: LlmProvider): string {
  switch (provider) {
    case "openrouter": return "OPENROUTER_API_KEY";
    case "gemini": return "GEMINI_API_KEY";
    case "openai": return "OPENAI_API_KEY";
    case "deepseek": return "DEEPSEEK_API_KEY";
    case "anthropic": return "ANTHROPIC_API_KEY";
  }
}

function apiKeyFor(provider: LlmProvider): string | undefined {
  // A single LLM_API_KEY wins if set (handy when one provider does everything);
  // otherwise fall back to the conventional per-provider env var.
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY;
  return process.env[envNameFor(provider)];
}

// True when the active provider has a usable API key. Replaces the old
// `if (!process.env.ANTHROPIC_API_KEY)` guards in the job routes.
export function llmConfigured(): boolean {
  return Boolean(apiKeyFor(LLM_PROVIDER));
}

// Default model per task tier, resolved for the active provider. `fast` is the
// cheap high-volume tier (enrichment, labeling); `smart` is the few-times-a-day
// comparative/editorial tier (rerank, briefs) worth a stronger model.
const MODELS: Record<LlmProvider, { fast: string; smart: string }> = {
  // OpenRouter routes to the same Gemini models, just one key for everything and
  // free model-switching. Slugs are provider-prefixed.
  openrouter: { fast: "google/gemini-2.5-flash-lite", smart: "google/gemini-2.5-flash" },
  gemini: { fast: "gemini-2.5-flash-lite", smart: "gemini-2.5-flash" },
  openai: { fast: "gpt-5-mini", smart: "gpt-5-mini" },
  deepseek: { fast: "deepseek-chat", smart: "deepseek-chat" },
  anthropic: { fast: "claude-haiku-4-5-20251001", smart: "claude-sonnet-4-6" },
};

// Per-task env override so cost/quality can be dialed without a code change.
function pick(envVar: string, fallback: string): string {
  const v = process.env[envVar];
  return v && v.trim() ? v.trim() : fallback;
}

const tier = MODELS[LLM_PROVIDER];

export const ENRICH_MODEL = pick("ENRICH_MODEL", tier.fast);
export const LABEL_MODEL = pick("LABEL_MODEL", tier.fast);
export const RERANK_MODEL = pick("RERANK_MODEL", tier.smart);
export const BRIEF_MODEL = pick("BRIEF_MODEL", tier.smart);

export async function chatText(opts: ChatOpts): Promise<string> {
  if (LLM_PROVIDER === "anthropic") return anthropicChat(opts);
  return openAICompatChat(LLM_PROVIDER, opts);
}

async function openAICompatChat(provider: LlmProvider, opts: ChatOpts): Promise<string> {
  const base = OPENAI_COMPAT_BASE[provider];
  if (!base) throw new Error(`LLM provider "${provider}" has no OpenAI-compatible endpoint`);
  const key = apiKeyFor(provider);
  if (!key) throw new Error(`${envNameFor(provider)} not set`);

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0.3,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };
  // Gemini 2.5 Flash / Flash-Lite "think" by default, and reasoning tokens count
  // against max_tokens — with our small budgets the model could spend it all
  // thinking and return empty content. These are extraction/judgment tasks that
  // don't need a reasoning pass, so turn it off. The knob differs per API:
  //   - Gemini direct: reasoning_effort:"none" (NOT a valid OpenAI/DeepSeek value)
  //   - OpenRouter:    reasoning:{enabled:false}
  if (provider === "gemini") body.reasoning_effort = "none";
  if (provider === "openrouter") body.reasoning = { enabled: false };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
  };
  // Optional OpenRouter attribution (shows up on their dashboard/leaderboard).
  if (provider === "openrouter") {
    const site = process.env.NEXT_PUBLIC_SITE_URL;
    if (site) headers["HTTP-Referer"] = site;
    headers["X-Title"] = "StackBrief";
  }

  const resp = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`${provider} ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = (await resp.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  return extractContent(data?.choices?.[0]?.message?.content, provider);
}

function extractContent(content: unknown, provider: string): string {
  if (typeof content === "string" && content.trim()) return content;
  // Some OpenAI-compatible servers return content as an array of parts.
  if (Array.isArray(content)) {
    const text = content
      .map((p) => (typeof p === "string" ? p : (p as { text?: string })?.text ?? ""))
      .join("")
      .trim();
    if (text) return text;
  }
  throw new Error(`${provider}: no text in response`);
}

async function anthropicChat(opts: ChatOpts): Promise<string> {
  const anthropic = getAnthropic();
  const resp = await anthropic.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0.3,
    system: [{ type: "text", text: opts.system }],
    messages: [{ role: "user", content: opts.user }],
  });
  const block = resp.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("anthropic: no text block in response");
  return block.text;
}
