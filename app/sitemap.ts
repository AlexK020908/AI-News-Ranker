import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/types";

export default function sitemap(): MetadataRoute.Sitemap {
  // Intentionally NO `lastModified`. Emitting a fresh <lastmod> every day is the
  // signal Google turns into a "N days ago" stamp in the result snippet — the
  // exact thing we strip elsewhere (see the dateless-WebPage note in
  // app/page.tsx; commit 5a371f0 removed the JSON-LD date but the sitemap one
  // leaked it back in). This is an evergreen daily feed; omitting lastModified
  // keeps it dateless. `changeFrequency: "daily"` still tells Google to recrawl
  // often, so freshness isn't lost — only the visible date is.
  return [
    {
      url: SITE_URL,
      changeFrequency: "daily",
      priority: 1,
    },
    ...CATEGORIES.map((cat) => ({
      url: `${SITE_URL}/${cat}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    {
      url: `${SITE_URL}/repos`,
      changeFrequency: "daily",
      priority: 0.7,
    },
  ];
}
