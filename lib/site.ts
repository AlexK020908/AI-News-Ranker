// Single source of truth for the site's public identity. Metadata, robots,
// sitemap, and JSON-LD structured data all import from here so every absolute
// URL and brand string we emit agrees. SITE_URL mirrors the convention the
// email/webhook routes already use (NEXT_PUBLIC_SITE_URL) with a production
// fallback, so canonical tags / sitemap entries never drift from the origin
// those flows send links from.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://stackbrief.tech";

export const SITE_NAME = "StackBrief";
export const SITE_TAGLINE = "the fastest way to keep up with AI";
export const SITE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;
export const SITE_DESCRIPTION =
  "Daily AI briefing across papers, models, repos, and news. Clustered across sources so you read each story once.";

// Official brand profiles. These feed schema.org `sameAs`, the strongest
// signal for Google to tie this domain to the "StackBrief" entity (knowledge
// panel + verified-brand recognition). Uncomment / add real URLs as you
// create the accounts — empty/placeholder lines are filtered out below.
const SAME_AS_CANDIDATES: string[] = [
  "https://x.com/StackBriefTech",
  // "https://www.linkedin.com/company/your_company",
  // "https://github.com/your_org",
];
export const SITE_SAME_AS = SAME_AS_CANDIDATES.filter(
  (u) => u && !u.includes("your_"),
);
