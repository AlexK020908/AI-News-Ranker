import type { SourceKind, RawIngestedItem } from "@/lib/types";

export type IngestRawItem = RawIngestedItem;

export interface IngestContext {
  sourceSlug: string;
  sourceName: string;
  sourceKind: SourceKind;
  config: Record<string, unknown>;
}

export interface AdapterResult {
  items: IngestRawItem[];
  error?: string | null;
}

export type Adapter = (ctx: IngestContext) => Promise<AdapterResult>;

export const USER_AGENT = "ai-news-feed/0.1 (+https://ai-news-feed.local)";
