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
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  // Machine-readable date for search engines. A single semantic <time> that
  // agrees with the JSON-LD dateModified is the strongest "this page is fresh"
  // signal — far clearer than the ~hundreds of relative "Nd ago" strings on the
  // cards below. Built from the same local `now` so it always matches dateStr.
  const dateISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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
          <time dateTime={dateISO}>{dateStr}</time>
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
