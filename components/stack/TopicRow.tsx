"use client";

import { useEffect, useRef, useState } from "react";
import type { StackCluster } from "@/lib/stack/types";
import { ClusterCard } from "./ClusterCard";

interface Props {
  label: string;
  clusters: StackCluster[];
  onOpen: (id: string) => void;
}

// Horizontal scrolling row of fixed-size cluster cards for a single topic.
// The "memecope"-style layout: one row per category, so a dominant category
// like Papers can't overflow the page and squeeze everything else out.
//
// Scroll is native overflow-x with mouse-drag fallback and arrow controls.
// Card width is fixed via .cluster[data-variant="row"] so every card lines
// up cleanly regardless of summary/title length.
export function TopicRow({ label, clusters, onOpen }: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setCanLeft(el.scrollLeft > 4);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [clusters.length]);

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Scroll by roughly one card-width worth so the click moves visibly but
    // doesn't snap past content.
    const step = Math.max(280, Math.floor(el.clientWidth * 0.8));
    el.scrollBy({ left: step * dir, behavior: "smooth" });
  };

  if (clusters.length === 0) return null;

  return (
    <section className="topic-row" aria-label={label}>
      <div className="topic-row__head">
        <h2 className="topic-row__title">{label}</h2>
        <span className="topic-row__count">
          {clusters.length} {clusters.length === 1 ? "story" : "stories"}
        </span>
        <span className="topic-row__spacer" />
        <div className="topic-row__nav" aria-hidden={!canLeft && !canRight}>
          <button
            className="topic-row__btn"
            onClick={() => scrollBy(-1)}
            disabled={!canLeft}
            aria-label={`Scroll ${label} left`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M9 11L4 7l5-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className="topic-row__btn"
            onClick={() => scrollBy(1)}
            disabled={!canRight}
            aria-label={`Scroll ${label} right`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M5 3l5 4-5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <div className="topic-row__scroller" ref={scrollerRef}>
        {clusters.map((c, i) => (
          <ClusterCard
            key={c.id}
            cluster={c}
            variant="row"
            onOpen={onOpen}
            index={i}
          />
        ))}
      </div>
    </section>
  );
}
