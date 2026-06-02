"use client";

import { useEffect, useRef, useState } from "react";
import type { NewsBrief, NewsBriefCitation } from "@/lib/news-brief";
import { useScrollY } from "@/lib/stack/hooks";
import { Nav } from "./Nav";

interface Props {
  brief?: NewsBrief | null;
}

// Inline citation chip — identical behaviour to the one on /x: a [n] becomes a
// link to the story's source. A single source links straight out; a multi-post
// citation opens a small flyout. Falls back to a muted "[n]" when we have no
// source for the number.
function CitationChip({ n, citation }: { n: number; citation: NewsBriefCitation | undefined }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!citation || citation.posts.length === 0) {
    return <sup className="cite cite--dead">[{n}]</sup>;
  }
  if (citation.posts.length === 1) {
    return (
      <sup className="cite">
        <a href={citation.posts[0].url} target="_blank" rel="noopener noreferrer" title={citation.label}>
          {n}
        </a>
      </sup>
    );
  }
  return (
    <span className="cite cite--multi" ref={ref}>
      <button
        type="button"
        className="cite__btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`${citation.posts.length} sources`}
      >
        {n}<span className="cite__count">·{citation.posts.length}</span>
      </button>
      {open && (
        <span className="cite__flyout" role="menu">
          <span className="cite__flyout-head">{citation.label} · {citation.posts.length} sources</span>
          {citation.posts.map((p, i) => (
            <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="cite__flyout-item" role="menuitem">
              {p.handle}
            </a>
          ))}
        </span>
      )}
    </span>
  );
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
                    <CitationChip n={t.cite} citation={citations?.[String(t.cite)]} />
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
