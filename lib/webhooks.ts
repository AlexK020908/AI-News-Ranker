import type { Category } from "@/lib/types";

const DISCORD_HOST_PREFIXES = [
  "https://discord.com/api/webhooks/",
  "https://discordapp.com/api/webhooks/",
  "https://canary.discord.com/api/webhooks/",
  "https://ptb.discord.com/api/webhooks/",
];

export function isDiscordWebhookUrl(url: string): boolean {
  return DISCORD_HOST_PREFIXES.some((p) => url.startsWith(p));
}

export function generateManageToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface DiscordEmbed {
  title: string;
  description?: string;
  url: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordPayload {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
}

// 95+ rose, 85+ amber, 70+ yellow, 50+ green, else gray.
export function importanceColor(importance: number): number {
  if (importance >= 95) return 0xf43f5e;
  if (importance >= 85) return 0xfb923c;
  if (importance >= 70) return 0xeab308;
  if (importance >= 50) return 0x22c55e;
  return 0x9ca3af;
}

export async function postToDiscord(
  url: string,
  payload: DiscordPayload,
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; error?: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: body.slice(0, 200) };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message.slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
}

export interface NotifyItem {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  importance: number | null;
  category: Category | null;
  duplicate_count: number;
  source_name: string;
  published_at: string | null;
}

export function buildItemEmbed(item: NotifyItem, manageUrl?: string): DiscordPayload {
  const importance = item.importance ?? 0;
  const sourceSuffix =
    item.duplicate_count >= 2 ? ` · ${1 + item.duplicate_count} sources` : "";
  const fields: DiscordEmbed["fields"] = [
    { name: "Importance", value: `${importance}/100`, inline: true },
    { name: "Source", value: `${item.source_name}${sourceSuffix}`, inline: true },
  ];
  if (item.category) fields.push({ name: "Category", value: item.category, inline: true });

  const embed: DiscordEmbed = {
    title: item.title.slice(0, 256),
    description: (item.summary ?? "").slice(0, 400),
    url: item.url,
    color: importanceColor(importance),
    fields,
    footer: manageUrl
      ? { text: `ai-news-feed · unsubscribe: ${manageUrl}` }
      : { text: "ai-news-feed" },
    timestamp: item.published_at ?? undefined,
  };

  return { embeds: [embed], username: "ai-news-feed" };
}
