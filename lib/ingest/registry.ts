import type { SourceKind } from "@/lib/types";
import type { Adapter } from "./types";
import { rssAdapter } from "./rss";
import { arxivAdapter } from "./arxiv";
import { githubTrendingAdapter } from "./github-trending";
import { hackernewsAdapter } from "./hackernews";
import { huggingfaceModelsAdapter, huggingfaceDatasetsAdapter } from "./huggingface";

export const adapters: Partial<Record<SourceKind, Adapter>> = {
  rss: rssAdapter,
  arxiv: arxivAdapter,
  github_trending: githubTrendingAdapter,
  github_search: githubTrendingAdapter,
  hackernews: hackernewsAdapter,
  huggingface_models: huggingfaceModelsAdapter,
  huggingface_datasets: huggingfaceDatasetsAdapter,
};
