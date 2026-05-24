import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Served at /sitemap.xml. Lists the stable, publicly-indexable routes. Topic
// and item detail pages are DB-driven and force-dynamic, so they're left out
// here rather than enumerated at build time — add a generateSitemaps-backed
// per-segment sitemap if/when those pages become worth indexing individually.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/repos`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
  ];
}
