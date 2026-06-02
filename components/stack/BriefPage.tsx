"use client";

import { useEffect, useState } from "react";
import type { NewsBrief } from "@/lib/news-brief";
import { useScrollY } from "@/lib/stack/hooks";
import { CitationChip } from "./CitationChip";
import { Nav } from "./Nav";

interface Props {
  brief?: NewsBrief | null;
}

// The /brief section: the ranked "What's going on in AI Space" list — each
// topic a headline + a few bullet points, ordered by importance, with a [n]
// citation chip linking to the source. The news counterpart to /x.
export function BriefPage({ brief }: Props) {
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

  const topics = brief?.sections?.topics ?? [];
  const citations = brief?.citations ?? null;
  const day = brief?.generated_at ? new Date(brief.generated_at).toISOString().slice(0, 10) : null;

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
        {topics.length > 0 ? (
          <section className="x-brief" aria-label="What's going on in AI Space">
            <h1 className="x-brief__h1">What&apos;s going on in AI Space</h1>
            <div className="x-brief__meta">
              {day ? `${day} · ` : ""}{topics.length} {topics.length === 1 ? "story" : "stories"}
            </div>
            <ol className="news-brief__list">
              {topics.map((t, i) => (
                <li key={i} className="news-brief__topic">
                  <div className="news-brief__title">
                    {t.title}
                    <CitationChip n={t.cite} citation={citations?.[String(t.cite)]} variant="news" />
                  </div>
                  {t.bullets.length > 0 && (
                    <ul className="news-brief__bullets">
                      {t.bullets.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <div className="empty">
            No brief yet. <b>Check back in the morning.</b>
          </div>
        )}
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
