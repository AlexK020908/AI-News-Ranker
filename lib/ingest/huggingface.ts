import { truncate } from "@/lib/utils";
import type { Adapter } from "./types";
import { fetchJson, readNumberConfig, readStringConfig } from "./http";

interface HFModel {
  id: string;
  author?: string;
  lastModified?: string;
  createdAt?: string;
  likes?: number;
  downloads?: number;
  pipeline_tag?: string;
  tags?: string[];
}

interface HFDataset {
  id: string;
  author?: string;
  lastModified?: string;
  createdAt?: string;
  likes?: number;
  downloads?: number;
  description?: string;
  tags?: string[];
}

export const huggingfaceModelsAdapter: Adapter = async (ctx) => {
  const sort = readStringConfig(ctx, "sort", "trendingScore");
  const limit = readNumberConfig(ctx, "limit", 30);
  const url = `https://huggingface.co/api/models?sort=${encodeURIComponent(sort)}&direction=-1&limit=${limit}`;
  try {
    const json = await fetchJson<HFModel[]>(url);
    const items = json.map((m) => ({
      external_id: `hfm:${m.id}`,
      url: `https://huggingface.co/${m.id}`,
      title: truncate(m.id, 400),
      author: m.author ?? m.id.split("/")[0] ?? null,
      content:
        truncate(
          [
            m.pipeline_tag ? `task: ${m.pipeline_tag}` : "",
            typeof m.downloads === "number" ? `↓ ${m.downloads.toLocaleString()}` : "",
            typeof m.likes === "number" ? `♥ ${m.likes}` : "",
            m.tags?.length ? `tags: ${m.tags.slice(0, 8).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          2000,
        ) || null,
      published_at: m.lastModified || m.createdAt || null,
      raw: { likes: m.likes, downloads: m.downloads, tags: m.tags ?? [], pipeline_tag: m.pipeline_tag },
    }));
    return { items };
  } catch (e) {
    return { items: [], error: `hf-models: ${(e as Error).message}` };
  }
};

export const huggingfaceDatasetsAdapter: Adapter = async (ctx) => {
  const sort = readStringConfig(ctx, "sort", "trendingScore");
  const limit = readNumberConfig(ctx, "limit", 30);
  const url = `https://huggingface.co/api/datasets?sort=${encodeURIComponent(sort)}&direction=-1&limit=${limit}`;
  try {
    const json = await fetchJson<HFDataset[]>(url);
    const items = json.map((d) => ({
      external_id: `hfd:${d.id}`,
      url: `https://huggingface.co/datasets/${d.id}`,
      title: truncate(d.id, 400),
      author: d.author ?? d.id.split("/")[0] ?? null,
      content:
        truncate(
          [
            d.description || "",
            typeof d.downloads === "number" ? `↓ ${d.downloads.toLocaleString()}` : "",
            typeof d.likes === "number" ? `♥ ${d.likes}` : "",
            d.tags?.length ? `tags: ${d.tags.slice(0, 8).join(", ")}` : "",
          ]
            .filter(Boolean)
            .join(" · "),
          2000,
        ) || null,
      published_at: d.lastModified || d.createdAt || null,
      raw: { likes: d.likes, downloads: d.downloads, tags: d.tags ?? [] },
    }));
    return { items };
  } catch (e) {
    return { items: [], error: `hf-datasets: ${(e as Error).message}` };
  }
};
