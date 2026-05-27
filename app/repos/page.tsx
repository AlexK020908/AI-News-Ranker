import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCache, cacheKeys, ttl } from "@/lib/cache/redis";
import { loadTrendingRepos, type TrendingRepo, type HumanLang } from "@/lib/trending-repos";
import { trendingRepoToCard } from "@/lib/stack/trending-repo-transform";
import { ReposPage } from "@/components/stack/ReposPage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MIN_STARS = 500;
const DAYS_BACK = 14;
const MAX_ROWS = 200;

// Whitelist for language values that flow into the SQL filter. Anything
// not in this set falls back to "All" — keeps the URL surface from being
// a wildcard injection vector even though the value is parameterized.
const KNOWN_LANGUAGES = new Set([
  "Python",
  "TypeScript",
  "JavaScript",
  "Jupyter Notebook",
  "Rust",
  "Go",
  "C++",
  "Java",
  "C#",
  "C",
  "Swift",
  "Kotlin",
  "Ruby",
  "Shell",
  "HTML",
]);

function pickLanguage(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  return KNOWN_LANGUAGES.has(v) ? v : null;
}

function pickTopic(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  // GitHub topic tags: lowercase alphanumerics + hyphens, up to 50 chars.
  // Reject anything else as a guardrail — the SQL is parameterized anyway,
  // but a clean URL value keeps caching predictable.
  return /^[a-z0-9][a-z0-9-]{0,49}$/.test(v) ? v : null;
}

const HUMAN_LANGS: ReadonlySet<HumanLang> = new Set([
  "english", "chinese", "japanese", "korean",
]);

function pickHumanLang(raw: string | string[] | undefined): HumanLang | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  return HUMAN_LANGS.has(v as HumanLang) ? (v as HumanLang) : null;
}

interface PageProps {
  searchParams: Promise<{
    lang?: string | string[];
    topic?: string | string[];
    locale?: string | string[];
  }>;
}

export default async function Repos({ searchParams }: PageProps) {
  const params = await searchParams;
  const language  = pickLanguage(params.lang);
  const topic     = pickTopic(params.topic);
  const humanLang = pickHumanLang(params.locale);

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return <ReposPage repos={[]} language={language} topic={topic} humanLang={humanLang} />;
  }

  const supabase = await createSupabaseServerClient();
  const cache = getCache();

  const cacheKey = `${cacheKeys.trendingRepos(MIN_STARS, DAYS_BACK, MAX_ROWS)}:${language ?? "*"}:${topic ?? "*"}:${humanLang ?? "*"}`;
  const repos = await cache.remember<TrendingRepo[]>(
    cacheKey,
    ttl.trendingRepos,
    () => loadTrendingRepos(supabase, {
      minStars: MIN_STARS,
      daysBack: DAYS_BACK,
      maxRows: MAX_ROWS,
      language,
      topic,
      humanLang,
    }),
  );

  return (
    <ReposPage
      repos={repos.map(trendingRepoToCard)}
      language={language}
      topic={topic}
      humanLang={humanLang}
    />
  );
}
