import { loadHomeData } from "@/lib/home-loader";
import { StackApp } from "@/components/stack/StackApp";
import { SITE_URL, SITE_TITLE } from "@/lib/site";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const { clusters, risingSingletons, trendingRepos } = await loadHomeData();

  // Intentionally NO dateModified/datePublished here. This is an evergreen daily
  // feed; emitting a date made Google show a "N days ago" stamp in the result
  // snippet, which we don't want. Omitting all date fields is the strongest
  // signal for Google to treat the page as dateless. WebPage is linked into the
  // WebSite/Organization @graph declared in app/layout.tsx via matching @ids.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}/#webpage`,
    url: SITE_URL,
    name: SITE_TITLE,
    isPartOf: { "@id": `${SITE_URL}/#website` },
    about: { "@id": `${SITE_URL}/#organization` },
    publisher: { "@id": `${SITE_URL}/#organization` },
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
