import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TITLE,
  SITE_DESCRIPTION,
  SITE_SAME_AS,
} from "@/lib/site";

const jetbrains = JetBrains_Mono({
  variable: "--font-mono-google",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  // metadataBase lets every relative URL-based field below (canonical, OG)
  // resolve to a fully-qualified https://stackbrief.tech/... URL.
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  // The banner is referenced explicitly from /public (see public/og.png) rather
  // than via the app/opengraph-image.png file convention. The convention image
  // inherited the root segment's `force-dynamic` config and was therefore served
  // `Cache-Control: max-age=0, must-revalidate`, forcing every social scraper to
  // re-fetch it from the EC2 origin on each unfurl. With no CDN in front, a single
  // slow/cold fetch made scrapers cache a *blank* card against that specific URL —
  // why some share links (e.g. /?cluster=...) showed no banner while the bare URL
  // did. A /public asset is filesystem-served, immune to the segment config, and
  // gets an immutable Cache-Control via next.config.ts headers(). Same banner,
  // reliably, on every shareable link. NOTE: the URL is stable, so if you replace
  // the banner, bump the filename (og-2.png) to bust scraper/browser caches.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      { url: "/og.png", width: 1200, height: 630, alt: SITE_TITLE },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: SITE_TITLE }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Structured data describing the brand + site. Organization is what Google
  // links the domain to the "StackBrief" entity (and eventually a knowledge
  // panel); WebSite + SearchAction declares the brand name and can surface a
  // sitelinks search box for branded queries. Rendered as a native <script>
  // per Next's JSON-LD guidance; `<` is escaped to neutralize XSS via any
  // future interpolated field.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        ...(SITE_SAME_AS.length > 0 ? { sameAs: SITE_SAME_AS } : {}),
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        description: SITE_DESCRIPTION,
        publisher: { "@id": `${SITE_URL}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };

  return (
    <html lang="en" className={jetbrains.variable} data-theme="dark">
      {/* Browser extensions (Grammarly, etc.) inject attributes like
          data-gr-ext-installed onto <body> before React hydrates, which trips
          a benign hydration-mismatch warning. suppressHydrationWarning scopes
          the opt-out to this one element. */}
      <body suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
        {children}
      </body>
      {/* GA4 via the official Next integration (loads gtag.js after hydration).
          Gated on the env var so it's a no-op until a measurement ID is set —
          local/dev and preview deploys stay untracked unless configured. */}
      {process.env.NEXT_PUBLIC_GA_ID && (
        <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
      )}
    </html>
  );
}
