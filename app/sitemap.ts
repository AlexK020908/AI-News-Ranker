import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/types";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    ...CATEGORIES.map((cat) => ({
      url: `${SITE_URL}/${cat}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    {
      url: `${SITE_URL}/repos`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
  ];
}
