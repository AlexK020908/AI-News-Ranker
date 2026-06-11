"use client";

import { useEffect, useState } from "react";
import type { XBriefCitation } from "@/lib/x";
import { useScrollY } from "@/lib/stack/hooks";
import { CitationChip } from "./CitationChip";
import { Nav } from "./Nav";

type Citations = Record<string, XBriefCitation> | null | undefined;

interface Props {
  brief?: string | null;
  citations?: Citations;
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

// Inline tokenizer: **bold** and [n] citation markers. The model doesn't only
// emit single [n] — it groups citations ([2, 16]) and ranges them ([1-3]) — so
// we match any bracket of digits/commas/hyphens and expand it into one chip per
// cited index. Bracket content that isn't a clean numeric list falls back to
// literal text.
function inline(s: string, citations: Citations): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*.+?\*\*)|\[([\d\s,-]+)\]/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) out.push(<span key={key++}>{s.slice(last, m.index)}</span>);
    if (m[1]) {
      out.push(<strong key={key++}>{m[1].slice(2, -2)}</strong>);
    } else {
      const nums = parseCiteList(m[2]);
      if (nums.length === 0) {
        out.push(<span key={key++}>{m[0]}</span>);
      } else {
        nums.forEach((n, j) => {
          // Muted superscript comma so "[2, 16]" reads as two chips, not "216".
          if (j > 0) out.push(<sup key={key++} className="cite cite--dead">,</sup>);
          out.push(<CitationChip key={key++} n={n} citation={citations?.[String(n)]} />);
        });
      }
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(<span key={key++}>{s.slice(last)}</span>);
  return out;
}

// Parse a citation bracket body into its cited indices: single numbers, comma
// lists, and small ranges ("2, 16" -> [2,16]; "1-3" -> [1,2,3]). Returns [] for
// anything that isn't a clean numeric citation (a stray "[2020-2024]" or
// "[wip]") so the caller renders the bracket as literal text.
function parseCiteList(body: string): number[] {
  // Citation indices reference the handful of posts/sources reviewed, so any
  // number this large is not a citation — it's a year or stat. Reject the whole
  // bracket as literal text rather than minting dead chips (e.g. "[2020-2024]").
  const MAX_CITE = 99;
  const out: number[] = [];
  for (const tok of body.split(",")) {
    const t = tok.trim();
    if (!t) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(t);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (hi < lo || hi > MAX_CITE || hi - lo > 20) return [];
      for (let k = lo; k <= hi; k++) out.push(k);
      continue;
    }
    if (!/^\d+$/.test(t)) return [];
    const n = Number(t);
    if (n > MAX_CITE) return [];
    out.push(n);
  }
  return [...new Set(out)];
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
