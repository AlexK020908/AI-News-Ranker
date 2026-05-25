"use client";

import { useEffect, useState } from "react";
import type { StackCluster } from "@/lib/stack/types";
import { useScrollY } from "@/lib/stack/hooks";
import { Nav } from "./Nav";
import { ClusterCard } from "./ClusterCard";
import { ClusterDetail } from "./ClusterDetail";

interface Props {
  clusters: StackCluster[];
}

// The /x section reuses the home page's cluster rendering (ClusterCard +
// ClusterDetail) but is intentionally simpler: no category pills, no rising
// strip, no subscribe/onboarding flows — just the tweet clusters + solo tweets,
// already ranked server-side. Detail opens inline (ClusterDetail) rather than a
// route, since x_topics live in their own tables and have no /topic/[slug] page.
export function XPage({ clusters }: Props) {
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
