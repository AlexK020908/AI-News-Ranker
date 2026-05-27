import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CATEGORIES, CATEGORY_LABELS, isCategory } from "@/lib/types";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { loadHomeData } from "@/lib/home-loader";
import { StackApp } from "@/components/stack/StackApp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ category: c }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  if (!isCategory(category)) return {};
  const label = CATEGORY_LABELS[category];
  const title = `${label} — ${SITE_NAME}`;
  const description = `Latest AI ${label.toLowerCase()} stories, clustered across sources.`;
  return {
    title,
    description,
    alternates: { canonical: `/${category}` },
    openGraph: {
      title,
      description,
      type: "website",
      url: `${SITE_URL}/${category}`,
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  if (!isCategory(category)) notFound();

  const { clusters, risingSingletons, trendingRepos } = await loadHomeData();

  return (
    <StackApp
      clusters={clusters}
      risingSingletons={risingSingletons}
      trendingRepos={trendingRepos}
      defaultTopic={category}
    />
  );
}
