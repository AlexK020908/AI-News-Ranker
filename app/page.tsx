import { loadHomeData } from "@/lib/home-loader";
import { StackApp } from "@/components/stack/StackApp";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const { clusters, risingSingletons, trendingRepos } = await loadHomeData();

  return (
    <StackApp
      clusters={clusters}
      risingSingletons={risingSingletons}
      trendingRepos={trendingRepos}
    />
  );
}
