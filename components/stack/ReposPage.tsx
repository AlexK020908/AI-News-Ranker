"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TrendingRepoCard } from "@/lib/stack/trending-repo-transform";
import type { HumanLang } from "@/lib/trending-repos";
import { useScrollY } from "@/lib/stack/hooks";
import { Nav } from "./Nav";
import { Select } from "./Select";
import { TrendingReposStrip } from "./TrendingReposStrip";

interface Props {
  repos: TrendingRepoCard[];
  language: string | null;
  topic: string | null;
  humanLang: HumanLang | null;
}

// Display labels for the locale filter — kept short to fit pill width.
const HUMAN_LANGS: { id: HumanLang; label: string }[] = [
  { id: "english",  label: "English" },
  { id: "chinese",  label: "中文" },
  { id: "japanese", label: "日本語" },
  { id: "korean",   label: "한국어" },
];

// Hard-coded so the picker has a stable, curated set even when no repos
// in the current filter share these tags. Real values are case-sensitive
// to match GitHub's canonical casing on `raw.language`.
const LANGUAGES = [
  "Python",
  "TypeScript",
  "JavaScript",
  "Jupyter Notebook",
  "Rust",
  "Go",
  "C++",
  "Java",
];

// AI-relevant GitHub topic tags. These are the topics that show up
// repeatedly across the trending corpus; users can always reach more
// niche tags by clicking any chip on a card (which deep-links into the
// same filter).
const TOPICS = [
  "llm",
  "ai-agent",
  "rag",
  "agent",
  "claude-code",
  "model-context-protocol",
  "generative-ai",
  "deep-learning",
  "gpt",
  "machine-learning",
  "transformers",
  "diffusion-models",
  "fine-tuning",
  "computer-vision",
  "nlp",
  "open-source",
];

export function ReposPage({ repos, language, topic, humanLang }: Props) {
  const router = useRouter();
  const [dark, setDark] = useState(true);
  const scrollY = useScrollY();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  const docMax = typeof document !== "undefined"
    ? Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    : 1;
  const progress = Math.min(100, (scrollY / docMax) * 100);
  const showToTop = scrollY > 600;

  // Filter changes round-trip to the server (the SQL function does the
  // narrowing). useRouter.push triggers a new server render with the
  // updated search params.
  const updateFilters = (next: {
    language?:  string    | null;
    topic?:     string    | null;
    humanLang?: HumanLang | null;
  }) => {
    const params = new URLSearchParams();
    const nextLang   = next.language  !== undefined ? next.language  : language;
    const nextTopic  = next.topic     !== undefined ? next.topic     : topic;
    const nextLocale = next.humanLang !== undefined ? next.humanLang : humanLang;
    if (nextLang)   params.set("lang", nextLang);
    if (nextTopic)  params.set("topic", nextTopic);
    if (nextLocale) params.set("locale", nextLocale);
    const qs = params.toString();
    router.push(qs ? `/repos?${qs}` : "/repos");
  };

  const activeFilters = useMemo(
    () => [language, topic, humanLang].filter(Boolean).length,
    [language, topic, humanLang],
  );

  return (
    <>
      <div className="progress" aria-hidden="true">
        <div className="progress__fill" style={{ width: `${progress}%` }} />
      </div>

      <Nav
        theme={dark ? "dark" : "light"}
        setTheme={(th) => setDark(th === "dark")}
        onShowOnb={() => { /* onboarding only lives on home */ }}
        scrolled={scrollY > 8}
      />

      <main className="shell">
        <header className="briefing">
          <div>
            <h1 className="briefing__greet">Trending repos</h1>
            <div className="briefing__meta">
              <span>High-star GitHub repos pushed in the last 7 days, not yet part of any cluster.</span>
            </div>
          </div>
          <div className="briefing__stats">
            <div>
              <b>{repos.length}</b>
              <span>repos</span>
            </div>
            <div>
              <b>1k+</b>
              <span>min stars</span>
            </div>
            <div>
              <b>7d</b>
              <span>window</span>
            </div>
          </div>
        </header>

        <section className="repo-filters" aria-label="Filter trending repos">
          <div className="repo-filters__row">
            <Select
              label="Language"
              value={language}
              placeholder="All languages"
              options={LANGUAGES.map((l) => ({ value: l, label: l }))}
              onChange={(v) => updateFilters({ language: v })}
            />
            <Select
              label="Topic"
              value={topic}
              placeholder="All topics"
              options={TOPICS.map((t) => ({ value: t, label: t }))}
              onChange={(v) => updateFilters({ topic: v })}
            />
            {activeFilters > 0 && (
              <button
                className="repo-filters__clear"
                onClick={() => updateFilters({ language: null, topic: null, humanLang: null })}
              >
                Clear all
              </button>
            )}
          </div>

          {/* Locale stays as pills — only 4 options, and the visual
              distinction (CJK glyphs) reads better as separate chips. */}
          <div className="repo-filters__row">
            <span className="repo-filters__label">Locale</span>
            <div className="repo-filters__pills">
              <button
                className="pill"
                aria-pressed={humanLang === null}
                onClick={() => updateFilters({ humanLang: null })}
              >
                <span className="pill__dot" />
                All
              </button>
              {HUMAN_LANGS.map((h) => (
                <button
                  key={h.id}
                  className="pill"
                  aria-pressed={humanLang === h.id}
                  onClick={() => updateFilters({ humanLang: humanLang === h.id ? null : h.id })}
                >
                  <span className="pill__dot" />
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {repos.length === 0 ? (
          <div className="empty">
            No repos match these filters. <b>Try clearing them.</b>
          </div>
        ) : (
          <TrendingReposStrip
            items={repos}
            onLanguageClick={(l) => updateFilters({ language: l })}
            onTopicClick={(t) => updateFilters({ topic: t })}
          />
        )}

        <div className="endbar">— {repos.length} repos shown —</div>
      </main>

      <button
        className={`to-top${showToTop ? " show" : ""}`}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
        title="Back to top"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 11V3M3 7l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </>
  );
}
