"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

const useBrowserLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
import type { StackCluster } from "@/lib/stack/types";
import type { RisingStandalone } from "@/lib/stack/rising-transform";
import type { TrendingRepoCard } from "@/lib/stack/trending-repo-transform";
import { CATEGORIES, CATEGORY_LABELS, isCategory, type Category } from "@/lib/types";
import { isStackTopicId } from "@/lib/stack/topics";
import { useClusterFreshness, useScrollY } from "@/lib/stack/hooks";
import { Nav } from "./Nav";
import { BriefingHeader } from "./BriefingHeader";
import { ClusterCard } from "./ClusterCard";
import { ClusterDetail } from "./ClusterDetail";
import { Onboarding } from "./Onboarding";
import { RisingStrip } from "./RisingStrip";
import { SubscribeModal } from "./SubscribeModal";
import { TopicRow } from "./TopicRow";
import { TrendingReposStrip } from "./TrendingReposStrip";

const CATEGORIES_KEY = "stack.categories";

// Display cap in single-topic view. Not applied to the "All" rows view —
// that uses per-category quotas (ROW_MAX) instead so each row fills.
const DISPLAY_MAX = 60;
// Per-topic cap in the "All" rows view. The server overfetches (MAX_TOPICS
// in app/page.tsx) so we can carve N cards per category here without
// running out. Cards beyond this point are not rendered for the row;
// the user can pill-filter to that category for the full list.
const ROW_MAX = 12;
// Minimum clusters needed to bother showing a topic row. A 1-card row looks
// like a layout glitch; below this floor the cluster is simply dropped from
// the rows view (still reachable via the topic pill or the rising strip).
const ROW_MIN = 1;

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
  risingSingletons?: RisingStandalone[];
  trendingRepos?: TrendingRepoCard[];
  defaultTopic?: string;
}

export function StackApp({
  clusters,
  risingSingletons = [],
  trendingRepos = [],
  defaultTopic = "all",
}: Props) {
  const [dark, setDark] = useState(true);
  const [accent] = useState("#f5a73c");
  const [topic, setTopic] = useState(defaultTopic);
  const [detailId, setDetailId] = useState<string | null>(null);
  const fromPopState = useRef(false);
  const [showOnb, setShowOnb] = useState(false);
  const [showSub, setShowSub] = useState(false);
  // Multi-select category subset for the "All" view. Default = every
  // category enabled (no filtering). Hydrated from localStorage on mount.
  const [enabledCategories, setEnabledCategories] = useState<ReadonlySet<Category>>(
    () => new Set<Category>(CATEGORIES),
  );
  const scrollY = useScrollY();
  // 60s poll cadence pairs with WORKER_INTERVAL_SEC=180 — anything faster
  // would mostly return empty diffs. The hook silently router.refresh()'s
  // when scrolled to top; otherwise reports a count for the pill below.
  const { pendingCount, acceptUpdates } = useClusterFreshness(60_000);

  // Hydrate persisted preferences once on mount. Doing this in a useEffect
  // rather than useState's lazy initializer avoids the SSR/CSR mismatch that
  // localStorage reads cause.
  useEffect(() => {
    try {
      const onbSeen = localStorage.getItem("stack.onb");
      // Lazy useState initializer would read localStorage during SSR (where
      // it's undefined) and trigger a hydration mismatch. Setting here on
      // mount is the intentional pattern — see comment above on why this
      // effect exists.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!onbSeen) setShowOnb(true);
    } catch {
      /* private mode — show by default */
    }
    try {
      const saved = localStorage.getItem(CATEGORIES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter(isCategory);
          // Empty set is intentionally allowed (user can hide everything)
          // but we reject malformed entries.
          setEnabledCategories(new Set<Category>(valid));
        }
      }
    } catch {
      /* private mode or corrupt JSON — keep the default */
    }
  }, []);

  // Persist on change. Skipped on the initial mount-with-default render
  // because writing "everything" before hydration would clobber a saved
  // empty set; the hydration effect above runs first.
  useEffect(() => {
    try {
      localStorage.setItem(CATEGORIES_KEY, JSON.stringify([...enabledCategories]));
    } catch { /* private mode — silently no-op */ }
  }, [enabledCategories]);

  // --- URL sync: read ?cluster=slug on mount and auto-open ---
  // useLayoutEffect prevents the flash where the home page renders
  // before the cluster detail opens.
  useBrowserLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get("cluster");
    if (slug) {
      const match = clusters.find((c) => c.slug === slug);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (match) setDetailId(match.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle browser back/forward to sync topic + cluster state with URL
  useEffect(() => {
    const handler = () => {
      fromPopState.current = true;
      const path = window.location.pathname.slice(1);
      if (path && isStackTopicId(path)) {
        setTopic(path);
      } else if (window.location.pathname === "/") {
        setTopic("all");
      }
      const params = new URLSearchParams(window.location.search);
      const slug = params.get("cluster");
      if (slug) {
        const match = clusters.find((c) => c.slug === slug);
        setDetailId(match?.id ?? null);
      } else {
        setDetailId(null);
      }
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [clusters]);

  const openCluster = useCallback(
    (id: string) => {
      const cluster = clusters.find((c) => c.id === id);
      setDetailId(id);
      if (cluster) {
        const url = new URL(window.location.href);
        url.searchParams.set("cluster", cluster.slug);
        window.history.pushState({ cluster: cluster.slug }, "", url.toString());
      }
    },
    [clusters],
  );

  const closeCluster = useCallback(() => {
    setDetailId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("cluster");
    window.history.pushState({}, "", url.toString());
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
    if (topic === "all") {
      // For the "All" view we DON'T pre-slice — the per-category quota in
      // topicRows below does the trimming. Slicing here would re-introduce
      // the dominant-category-crowds-out-everyone-else bug the rows layout
      // was built to fix.
      return clusters.filter((c) =>
        isCategory(c.topic) ? enabledCategories.has(c.topic) : true,
      );
    }
    // Single-topic view (user clicked a pill): the grid does benefit from
    // a cap, since long-tail categories can have hundreds of items.
    return clusters.filter((c) => c.topic === topic).slice(0, DISPLAY_MAX);
  }, [clusters, topic, enabledCategories]);

  // "All" view: bucket clusters by their modal category, take the top
  // ROW_MAX of each (already in trending_score order from the server), and
  // emit one row per category. Rows are ordered by total cluster volume
  // so the most-active category leads the page.
  const topicRows = useMemo(() => {
    if (topic !== "all") return [];
    const groups = new Map<Category, StackCluster[]>();
    for (const c of filtered) {
      const cat = isCategory(c.topic) ? c.topic : ("other" as Category);
      const arr = groups.get(cat) ?? [];
      if (arr.length < ROW_MAX) arr.push(c);
      groups.set(cat, arr);
    }
    return CATEGORIES
      .filter((cat) => (groups.get(cat)?.length ?? 0) >= ROW_MIN)
      .map((cat) => ({
        category: cat,
        label: CATEGORY_LABELS[cat],
        clusters: groups.get(cat) as StackCluster[],
      }))
      .sort((a, b) => b.clusters.length - a.clusters.length);
  }, [filtered, topic]);

  const detail = detailId ? clusters.find((c) => c.id === detailId) : null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (fromPopState.current) {
      fromPopState.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [detailId]);

  const handleSetTopic = (id: string) => {
    if (!isStackTopicId(id)) return;
    setTopic(id);
    setDetailId(null);
    const path = id === "all" ? "/" : `/${id}`;
    window.history.pushState({}, "", path);
  };

  return (
    <>
      <div className="progress" aria-hidden="true">
        <div className="progress__fill" style={{ width: `${progress}%` }} />
      </div>

      <Nav
        topic={topic}
        setTopic={handleSetTopic}
        enabledCategories={enabledCategories}
        setEnabledCategories={setEnabledCategories}
        theme={dark ? "dark" : "light"}
        setTheme={(th) => setDark(th === "dark")}
        onLogo={() => { setDetailId(null); setTopic("all"); window.history.pushState({}, "", "/"); }}
        onShowOnb={() => setShowOnb(true)}
        onShowSubscribe={() => setShowSub(true)}
        scrolled={scrollY > 8}
      />

      <main className="shell">
        {detail ? (
          <ClusterDetail cluster={detail} onBack={closeCluster} />
        ) : (
          <>
            <BriefingHeader
              clusters={filtered}
              visibleCount={filtered.length}
              topic={topic}
              scrollY={scrollY}
            />
            {filtered.length === 0 ? (
              <div className="empty">
                No clusters in this topic right now. <b>Check back soon.</b>
              </div>
            ) : topic === "all" ? (
              // "All" view: one horizontal scrolling row per category so no
              // single topic (papers, in particular) can crowd out the rest.
              <div className="topic-rows">
                {topicRows.map(({ category, label, clusters: row }) => (
                  <TopicRow
                    key={category}
                    label={label}
                    clusters={row}
                    onOpen={openCluster}
                  />
                ))}
              </div>
            ) : (
              // Single-topic view: keep the grid so the user gets the full
              // catalog of that category at once. data-topic lets the CSS
              // pick the right column width — paper cards are 320 (need
              // room for caveman), all other topics stay at 300.
              <div className="grid" data-topic={topic}>
                {filtered.map((c, i) => (
                  <ClusterCard
                    key={c.id}
                    cluster={c}
                    variant="row"
                    onOpen={openCluster}
                    index={i}
                  />
                ))}
              </div>
            )}
            {topic === "all" && risingSingletons.length > 0 && (
              <RisingStrip items={risingSingletons} />
            )}
            {/* Trending repos strip appears only when the user is on the
                Repo topic filter — keeps the default All view clean while
                giving the dedicated repo view the rich star-based cards. */}
            {topic === "repo" && trendingRepos.length > 0 && (
              <TrendingReposStrip items={trendingRepos} />
            )}
            <footer className="site-footer">
              <a href="mailto:business@stackbrief.tech" className="site-footer__link" aria-label="Email us">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" />
                  <path d="M2 7l10 6 10-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>business@stackbrief.tech</span>
              </a>
              <a href="https://x.com/StackBriefTech" target="_blank" rel="noopener noreferrer" className="site-footer__link" aria-label="Follow us on X">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <span>@StackBriefTech</span>
              </a>
            </footer>
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

      {pendingCount > 0 && (
        <button
          className="new-updates-pill"
          onClick={acceptUpdates}
          aria-label={`${pendingCount} new updates — click to refresh`}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 11V3M3 7l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {pendingCount} new
        </button>
      )}

      {showOnb && <Onboarding onDone={onOnbDone} />}
      {showSub && <SubscribeModal onClose={() => setShowSub(false)} />}
    </>
  );
}
