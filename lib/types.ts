export const CATEGORIES = [
  "paper",
  "model",
  "release",
  "repo",
  "funding",
  "announcement",
  "discussion",
  "tool",
  "news",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  paper: "Paper",
  model: "Model",
  release: "Release",
  repo: "Repo",
  funding: "Funding",
  announcement: "Announcement",
  discussion: "Discussion",
  tool: "Tool",
  news: "News",
  other: "Other",
};

export const SOURCE_KINDS = [
  "rss",
  "arxiv",
  "github_trending",
  "github_search",
  "hackernews",
  "reddit",
  "huggingface_models",
  "huggingface_datasets",
  "custom",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface Source {
  id: string;
  slug: string;
  name: string;
  kind: SourceKind;
  config: Record<string, unknown>;
  poll_interval_sec: number;
  enabled: boolean;
  last_polled_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface Item {
  id: string;
  source_id: string;
  external_id: string;
  url: string;
  title: string;
  author: string | null;
  content: string | null;
  content_hash: string | null;
  summary: string | null;
  category: Category | null;
  tags: string[];
  importance: number | null;
  embedding: number[] | null;
  published_at: string | null;
  ingested_at: string;
  enriched_at: string | null;
  enrich_error: string | null;
  raw: Record<string, unknown> | null;
}

export interface ItemWithSource extends Item {
  source: Pick<Source, "slug" | "name" | "kind">;
}

export interface RawIngestedItem {
  external_id: string;
  url: string;
  title: string;
  author?: string | null;
  content?: string | null;
  published_at?: string | null;
  raw?: Record<string, unknown>;
}
