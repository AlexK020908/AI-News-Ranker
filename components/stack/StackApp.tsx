"use client";

import { useEffect, useMemo, useState } from "react";
import type { StackCluster } from "@/lib/stack/types";
import { isStackTopicId } from "@/lib/stack/topics";
import { useScrollY } from "@/lib/stack/hooks";
import { Nav } from "./Nav";
import { BriefingHeader } from "./BriefingHeader";
import { ClusterCard } from "./ClusterCard";
import { MiniCluster } from "./MiniCluster";
import { ClusterDetail } from "./ClusterDetail";
import { Onboarding } from "./Onboarding";

const ACCENT_PRESETS = [
  { hex: "#f5a73c", oklch: "oklch(0.78 0.15 60)" },
  { hex: "#4d9dff", oklch: "oklch(0.72 0.15 245)" },
  { hex: "#5fd1a4", oklch: "oklch(0.78 0.13 160)" },
  { hex: "#e96ad6", oklch: "oklch(0.72 0.18 330)" },
];

function findAccentOklch(hex: string): string {
  return ACCENT_PRESETS.find((p) => p.hex === hex)?.oklch || "oklch(0.78 0.15 60)";
}

interface Props {
  clusters: StackCluster[];
}

export function StackApp({ clusters }: Props) {
  const [dark, setDark] = useState(true);
  const [accent] = useState("#f5a73c");
  const [topic, setTopic] = useState("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showOnb, setShowOnb] = useState(false);
  const scrollY = useScrollY();

  // Hydrate persisted preferences once on mount. Doing this in a useEffect
  // rather than useState's lazy initializer avoids the SSR/CSR mismatch that
  // localStorage reads cause.
  useEffect(() => {
    try {
      const onbSeen = localStorage.getItem("stack.onb");
      if (!onbSeen) setShowOnb(true);
    } catch {
      /* private mode — show by default */
    }
  }, []);

  const docMax = typeof document !== "undefined"
    ? Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
    : 1;
  const progress = Math.min(100, (scrollY / docMax) * 100);
  const showToTop = scrollY > 600;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    const oklch = findAccentOklch(accent);
    document.documentElement.style.setProperty("--accent", oklch);
    document.documentElement.style.setProperty(
      "--accent-soft",
      oklch.replace(")", " / 0.14)"),
    );
  }, [dark, accent]);

  const onOnbDone = () => {
    setShowOnb(false);
    try { localStorage.setItem("stack.onb", "1"); } catch {}
  };

  const filtered = useMemo(() => {
    if (topic === "all") return clusters;
    return clusters.filter((c) => c.topic === topic);
  }, [clusters, topic]);

  const detail = detailId ? clusters.find((c) => c.id === detailId) : null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [detailId]);

  const handleSetTopic = (id: string) => {
    if (!isStackTopicId(id)) return;
    setTopic(id);
    setDetailId(null);
  };

  return (
    <>
      <div className="progress" aria-hidden="true">
        <div className="progress__fill" style={{ width: `${progress}%` }} />
      </div>

      <Nav
        topic={topic}
        setTopic={handleSetTopic}
        theme={dark ? "dark" : "light"}
        setTheme={(th) => setDark(th === "dark")}
        onLogo={() => { setDetailId(null); setTopic("all"); }}
        onShowOnb={() => setShowOnb(true)}
        scrolled={scrollY > 8}
      />

      <main className="shell">
        {detail ? (
          <ClusterDetail cluster={detail} onBack={() => setDetailId(null)} />
        ) : (
          <>
            <BriefingHeader
              clusters={clusters}
              visibleCount={filtered.length}
              topic={topic}
              scrollY={scrollY}
            />
            {filtered.length === 0 ? (
              <div className="empty">
                No clusters in this topic right now. <b>Check back soon.</b>
              </div>
            ) : filtered.length >= 4 ? (
              <>
                <div className="home">
                  <ClusterCard
                    cluster={filtered[0]}
                    hero
                    onOpen={setDetailId}
                    index={0}
                  />
                  <div className="sidebar">
                    {filtered.slice(1, 4).map((c, i) => (
                      <MiniCluster
                        key={c.id}
                        cluster={c}
                        onOpen={setDetailId}
                        index={i + 1}
                      />
                    ))}
                  </div>
                </div>
                {filtered.length > 4 && (
                  <>
                    <div className="section-title">More briefs</div>
                    <div className="grid">
                      {filtered.slice(4).map((c, i) => (
                        <ClusterCard
                          key={c.id}
                          cluster={c}
                          variant="compact"
                          onOpen={setDetailId}
                          index={i + 4}
                        />
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="grid">
                {filtered.map((c, i) => (
                  <ClusterCard
                    key={c.id}
                    cluster={c}
                    variant="compact"
                    onOpen={setDetailId}
                    index={i}
                  />
                ))}
              </div>
            )}
            <div className="endbar">— end of today&apos;s brief —</div>
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

      {showOnb && <Onboarding onDone={onOnbDone} />}
    </>
  );
}
