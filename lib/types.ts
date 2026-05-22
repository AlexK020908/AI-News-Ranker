export const DEFAULT_REGION = "global";

export function isCategory(x: unknown): x is Category {
  return typeof x === "string" && (CATEGORIES as readonly string[]).includes(x);
}

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
  "huggingface_papers",
  "crawler",
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
  reputation_weight: number;
  region: string;
  crawl_config: Record<string, unknown>;
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
  duplicate_of: string | null;
  duplicate_count: number;
  engagement_score: number;
  source_weight_sum: number;
  topic_size: number;
  paper_citations: number | null;
  paper_influential_citations: number | null;
  paper_tldr: string | null;
  // Plain-English explanation of the paper for non-academic readers,
  // populated by the enrich job's CAVEMAN instruction. Null for all
  // non-paper items.
  caveman_summary: string | null;
  published_at: string | null;
  ingested_at: string;
  enriched_at: string | null;
  enrich_error: string | null;
  raw: Record<string, unknown> | null;
  // Optional in the type because most SELECT queries don't request them.
  // When loaded from a query that includes them, region defaults to 'global'
  // server-side; xml and s3_storage_id are null until populated.
  region?: string;
  xml?: string | null;
  s3_storage_id?: string | null;
}

export interface ItemWithSource extends Item {
  source: Pick<Source, "slug" | "name" | "kind">;
}

export const SORT_MODES = ["hot", "new", "trending"] as const;
export type SortMode = (typeof SORT_MODES)[number];

export function isSortMode(x: unknown): x is SortMode {
  return typeof x === "string" && (SORT_MODES as readonly string[]).includes(x);
}

// Coarser grouping over SourceKind — each tab in the feed filters to one of these.
// Kept distinct from Category (what the item is) vs SourceKind (DB-level adapter).
export const SOURCE_GROUPS = [
  "papers",
  "github",
  "huggingface",
  "discussion",
  "news",
] as const;

export type SourceGroup = (typeof SOURCE_GROUPS)[number];

export const SOURCE_GROUP_LABELS: Record<SourceGroup, string> = {
  papers: "Papers",
  github: "GitHub",
  huggingface: "Hugging Face",
  discussion: "Discussion",
  news: "News",
};

export const SOURCE_GROUP_KINDS: Record<SourceGroup, readonly SourceKind[]> = {
  papers: ["arxiv", "huggingface_papers"],
  github: ["github_trending", "github_search"],
  huggingface: ["huggingface_models", "huggingface_datasets"],
  discussion: ["hackernews", "reddit"],
  news: ["rss"],
};

export function isSourceGroup(x: unknown): x is SourceGroup {
  return typeof x === "string" && (SOURCE_GROUPS as readonly string[]).includes(x);
}

export function kindsFor(group: SourceGroup | null): SourceKind[] | null {
  return group ? [...SOURCE_GROUP_KINDS[group]] : null;
}

export interface TopicSummary {
  id: string;
  slug: string;
  label: string;
  summary: string | null;
  member_count: number;
  avg_importance: number | null;
  max_importance: number | null;
  trending_score: number;
}

export interface RawIngestedItem {
  external_id: string;
  url: string;
  title: string;
  author?: string | null;
  content?: string | null;
  published_at?: string | null;
  engagement_score?: number;
  raw?: Record<string, unknown>;
  // Per-item raw XML (or XML-serialized equivalent for non-RSS sources). Stored
  // inline on items.xml so we have the original payload for reprocessing.
  xml?: string | null;
  // Region override. If unset, the source's default region is used.
  region?: string | null;
  // Candidate thumbnail URL discovered during ingest (RSS enclosure, media:thumbnail).
  // The enrich step downloads and uploads to S3 → items.s3_storage_id.
  thumbnail_candidate_url?: string | null;
}
