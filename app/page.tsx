import { loadHomeData } from "@/lib/home-loader";
import { StackApp } from "@/components/stack/StackApp";
import { SITE_URL, SITE_TITLE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const { clusters, risingSingletons, trendingRepos, lastModified } =
    await loadHomeData();

  // Freshness signal for search engines. Google otherwise dates the snippet to
  // its last crawl ("4 days ago"), which reads as stale on a daily feed.
  // lastModified is the freshest story's publish time (computed in the loader,
  // not here, to keep this render pure). WebPage is linked into the WebSite/
  // Organization @graph declared in app/layout.tsx via matching @ids.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}/#webpage`,
    url: SITE_URL,
    name: SITE_TITLE,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
    dateModified: lastModified,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <StackApp
        clusters={clusters}
        risingSingletons={risingSingletons}
        trendingRepos={trendingRepos}
      />
    </>
  );
}
