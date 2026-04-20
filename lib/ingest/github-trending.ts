import { truncate } from "@/lib/utils";
import type { Adapter } from "./types";
import { fetchJson, readNumberConfig, readStringConfig } from "./http";

function sinceDate(since: string): string {
  const d = new Date();
  if (since === "weekly") d.setUTCDate(d.getUTCDate() - 7);
  else if (since === "monthly") d.setUTCMonth(d.getUTCMonth() - 1);
  else d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}

interface GHRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  pushed_at: string;
  created_at: string;
  owner?: { login: string };
  language: string | null;
  topics?: string[];
}

export const githubTrendingAdapter: Adapter = async (ctx) => {
  const topic = readStringConfig(ctx, "topic", "artificial-intelligence");
  const since = readStringConfig(ctx, "since", "daily");
  const minStars = readNumberConfig(ctx, "min_stars", 10);
  const q = `topic:${topic} pushed:>${sinceDate(since)} stars:>=${minStars}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=25`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  try {
    const json = await fetchJson<{ items?: GHRepo[] }>(url, { headers });
    const items = (json.items ?? []).map((r) => ({
      external_id: `gh:${r.id}`,
      url: r.html_url,
      title: truncate(r.full_name, 300),
      author: r.owner?.login ?? null,
      content: truncate(
        [
          r.description || "",
          `⭐ ${r.stargazers_count.toLocaleString()}`,
          r.language ? `lang: ${r.language}` : "",
          r.topics?.length ? `topics: ${r.topics.slice(0, 8).join(", ")}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        2000,
      ),
      published_at: r.pushed_at || r.created_at || null,
      raw: {
        stars: r.stargazers_count,
        topics: r.topics ?? [],
        language: r.language,
        topic_filter: topic,
      },
    }));
    return { items };
  } catch (e) {
    return { items: [], error: `github: ${(e as Error).message}` };
  }
};
