"use client";

import type { StackCluster } from "@/lib/stack/types";
import { STACK_TOPICS } from "@/lib/stack/topics";

interface Props {
  clusters: StackCluster[];
  visibleCount: number;
  topic: string;
  scrollY: number;
}

export function BriefingHeader({ clusters, visibleCount, topic, scrollY }: Props) {
  const now = new Date();
  // Display-only "today" greeting. Kept as a plain <span> (not a machine-readable
  // <time>) on purpose: we don't want to feed Google a date that turns into a
  // "N days ago" snippet stamp. See the no-dateModified note in app/page.tsx.
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const topicLabel = STACK_TOPICS.find((t) => t.id === topic)?.label || "All";
  const totalSources = clusters.reduce((acc, c) => acc + c.sources.length, 0);
  const totalRead = clusters.reduce((acc, c) => acc + c.readMin, 0);

  // Drift down + fade as the user scrolls past it.
  const k = Math.min(Math.max(scrollY / 320, 0), 1);
  const style = {
    opacity: 1 - k * 0.85,
    transform: `translateY(${k * -28}px)`,
  };

  return (
    <header className="briefing" style={style}>
      <div>
        <h1 className="briefing__greet">Your brief</h1>
        <div className="briefing__meta">
          <span>{dateStr}</span>
          <span className="cluster__head__sep">·</span>
          <span>Showing <b>{topicLabel}</b></span>
        </div>
      </div>
      <div className="briefing__stats">
        <div><b>{visibleCount}</b><span>clusters</span></div>
        <div><b>{topic === "all" ? totalSources : "—"}</b><span>sources</span></div>
        <div><b>{topic === "all" ? totalRead : "—"}</b><span>min read</span></div>
      </div>
    </header>
  );
}
