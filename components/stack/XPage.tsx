"use client";

import { useEffect, useRef, useState } from "react";
import type { XBriefCitation } from "@/lib/x";
import { useScrollY } from "@/lib/stack/hooks";
import { Nav } from "./Nav";

type Citations = Record<string, XBriefCitation> | null | undefined;

interface Props {
  brief?: string | null;
  citations?: Citations;
}

// Inline citation chip — the Google-AI-Overview move. A [n] in the brief becomes
// this: a single source links straight to the post on X; a cluster of N posts
// opens a small flyout listing them, each one click to X. Falls back to a plain
// muted "[n]" if the model cited a number we have no source for.
function CitationChip({ n, citation }: { n: number; citation: XBriefCitation | undefined }) {
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
  // Single source → direct link, no flyout needed.
  if (citation.posts.length === 1) {
    return (
      <sup className="cite">
        <a href={citation.posts[0].url} target="_blank" rel="noopener noreferrer" title={`@${citation.posts[0].handle} on X`}>
          {n}
        </a>
      </sup>
    );
  }
  // Multiple posts → chip opens a flyout of all of them.
  return (
    <span className="cite cite--multi" ref={ref}>
      <button
        type="button"
        className="cite__btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`${citation.posts.length} posts on X`}
      >
        {n}<span className="cite__count">·{citation.posts.length}</span>
      </button>
      {open && (
        <span className="cite__flyout" role="menu">
          <span className="cite__flyout-head">{citation.label} · {citation.posts.length} posts</span>
          {citation.posts.map((p, i) => (
            <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="cite__flyout-item" role="menuitem">
              𝕏 @{p.handle}
            </a>
          ))}
        </span>
      )}
    </span>
  );
}

// Minimal markdown → elements for the brief: `# h1`, `## h2`, `*meta line*`,
// blank-separated paragraphs, inline `**bold**`, and `[n]` citation chips.
// Themed via site CSS (.x-brief / .cite classes) so light/dark both work.
function renderBrief(markdown: string, citations: Citations) {
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  const flush = (key: string) => {
    if (para.length === 0) return;
    blocks.push(
      <p key={key} className="x-brief__p">{inline(para.join(" "), citations)}</p>,
    );
    para = [];
  };
  markdown.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (line === "") { flush(`p${i}`); return; }
    if (line.startsWith("## ")) { flush(`p${i}`); blocks.push(<h2 key={i} className="x-brief__h2">{line.slice(3)}</h2>); return; }
    if (line.startsWith("# "))  { flush(`p${i}`); blocks.push(<h1 key={i} className="x-brief__h1">{line.slice(2)}</h1>); return; }
    if (line.startsWith("*") && line.endsWith("*") && !line.startsWith("**")) {
      flush(`p${i}`); blocks.push(<div key={i} className="x-brief__meta">{line.slice(1, -1)}</div>); return;
    }
    para.push(line);
  });
  flush("end");
  return blocks;
}

// Inline tokenizer: **bold** and [n] citation markers.
function inline(s: string, citations: Citations): React.ReactNode[] {
  return s.split(/(\*\*.+?\*\*|\[\d+\])/g).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    const m = /^\[(\d+)\]$/.exec(part);
    if (m) {
      const n = Number(m[1]);
      return <CitationChip key={i} n={n} citation={citations?.[String(n)]} />;
    }
    return <span key={i}>{part}</span>;
  });
}

// The /x section is just the "On X today" brief — an AI synthesis of the day's
// AI-Twitter conversation with inline citation chips ([n]) that link straight to
// the source post(s) on X. No cluster grid / drill-down: the brief is the page,
// and the citations are the way into the underlying tweets. (The cluster data
// still exists server-side — it's what the brief is built from — but isn't
// rendered here.)
export function XPage({ brief, citations }: Props) {
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
        {brief ? (
          <section className="x-brief" aria-label="On X today">
            {renderBrief(brief, citations)}
          </section>
        ) : (
          <div className="empty">
            Nothing from X yet. <b>Check back soon.</b>
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
