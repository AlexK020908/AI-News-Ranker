"use client";

import { useEffect, useState } from "react";
import type { StackCluster } from "@/lib/stack/types";
import { useScrollY } from "@/lib/stack/hooks";
import { Nav } from "./Nav";
import { ClusterCard } from "./ClusterCard";
import { ClusterDetail } from "./ClusterDetail";

interface Props {
  clusters: StackCluster[];
  brief?: string | null;
}

// Minimal markdown → elements for the brief: `# h1`, `## h2`, `*meta line*`,
// blank-separated paragraphs, and inline `**bold**`. The brief prompt only ever
// emits those, so a full markdown lib would be overkill. Themed via site CSS
// (the .x-brief classes) rather than inline colors so light/dark both work.
function renderBrief(markdown: string) {
  const blocks: React.ReactNode[] = [];
  let para: string[] = [];
  const flush = (key: string) => {
    if (para.length === 0) return;
    blocks.push(
      <p key={key} className="x-brief__p">{inline(para.join(" "))}</p>,
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

// Inline **bold** only.
function inline(s: string): React.ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>,
  );
}

// The /x section reuses the home page's cluster rendering (ClusterCard +
// ClusterDetail) but is intentionally simpler: no category pills, no rising
// strip, no subscribe/onboarding flows — just the tweet clusters + solo tweets,
// already ranked server-side. Detail opens inline (ClusterDetail) rather than a
// route, since x_topics live in their own tables and have no /topic/[slug] page.
export function XPage({ clusters, brief }: Props) {
  const [dark, setDark] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const scrollY = useScrollY();

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  const docMax = typeof document !== "undefined"
    ? Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    : 1;
  const progress = Math.min(100, (scrollY / docMax) * 100);
  const showToTop = scrollY > 600;

  const detail = detailId ? clusters.find((c) => c.id === detailId) : null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [detailId]);

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
        {detail ? (
          <ClusterDetail cluster={detail} onBack={() => setDetailId(null)} />
        ) : (
          <>
            <header className="briefing">
              <div>
                <h1 className="briefing__greet">On X</h1>
                <div className="briefing__meta">
                  <span>What AI X is talking about — related posts grouped, newest first.</span>
                </div>
              </div>
              <div className="briefing__stats">
                <div>
                  <b>{clusters.length}</b>
                  <span>threads</span>
                </div>
              </div>
            </header>

            {brief && (
              <section className="x-brief" aria-label="On X today">
                {renderBrief(brief)}
              </section>
            )}

            {clusters.length === 0 ? (
              <div className="empty">
                Nothing from X yet. <b>Check back soon.</b>
              </div>
            ) : (
              <div className="grid" data-topic="news">
                {clusters.map((c, i) => (
                  <ClusterCard
                    key={c.id}
                    cluster={c}
                    variant="row"
                    onOpen={setDetailId}
                    index={i}
                    unit="tweet"
                  />
                ))}
              </div>
            )}

            <div className="endbar">— end of the X brief —</div>
          </>
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
