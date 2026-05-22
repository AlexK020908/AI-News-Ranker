"use client";

import { useRef, useState, type MouseEvent } from "react";
import type { StackCluster, StackSource } from "@/lib/stack/types";
import { STACK_TOPICS } from "@/lib/stack/topics";
import { hoursAgoLabel, plural } from "@/lib/stack/format";
import { SourceAvatar } from "./SourceAvatar";
import { RotatingThumb } from "./RotatingThumb";
import { SourcePreview } from "./SourcePreview";

interface Props {
  cluster: StackCluster;
  hero?: boolean;
  variant?: "compact";
  onOpen: (id: string) => void;
  index?: number;
}

interface HoverState {
  source: StackSource;
  x: number;
  y: number;
}

export function ClusterCard({ cluster, hero, variant, onOpen, index }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const topic = STACK_TOPICS.find((t) => t.id === cluster.topic);
  const cardRef = useRef<HTMLElement | null>(null);

  const handleSrcHover = (source: StackSource, e: MouseEvent<HTMLSpanElement>) => {
    if (!cardRef.current) return;
    const cardRect = cardRef.current.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left - cardRect.left + r.width / 2 - 140;
    const y = r.top - cardRect.top - 12 - 110;
    setHover({ source, x: Math.max(8, x), y: Math.max(8, y) });
  };
  const handleSrcLeave = () => setHover(null);

  return (
    <article
      className="cluster"
      data-hero={hero || undefined}
      data-variant={variant || undefined}
      ref={cardRef}
      style={{ animationDelay: `${Math.min(index || 0, 6) * 60}ms` }}
    >
      <div className="cluster__head">
        <span className="cluster__topic">{topic?.label}</span>
        <span className="cluster__head__sep">·</span>
        <span className="cluster__head__time">{hoursAgoLabel(cluster.hoursAgo)}</span>
        {cluster.breaking && (
          <>
            <span className="cluster__head__sep">·</span>
            <span className="cluster__head__badge">
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor" }} />
              Breaking
            </span>
          </>
        )}
        {cluster.rising && (
          <>
            <span className="cluster__head__sep">·</span>
            <span
              className="cluster__head__badge"
              title="Score climbing fast in the last 12h"
              style={{ color: "oklch(0.78 0.16 40)" }}
            >
              <span aria-hidden="true">🔥</span>
              Rising
            </span>
          </>
        )}
        <span className="cluster__head__spacer" />
      </div>

      <h2 className="cluster__title" onClick={() => onOpen(cluster.id)} style={{ cursor: "pointer" }}>
        {cluster.headline}
      </h2>

      <div className="cluster__body">
        <RotatingThumb sources={cluster.sources} paused={expanded} />
        <p className="cluster__summary">{cluster.summary}</p>
      </div>

      <div className="cluster__foot">
        <div className="sources">
          {cluster.sources.slice(0, 5).map((s, i) => (
            <SourceAvatar
              key={i}
              source={s}
              onHover={(e) => handleSrcHover(s, e)}
              onLeave={handleSrcLeave}
            />
          ))}
        </div>
        <div className="cluster__count">
          Covered by <b>{cluster.sources.length}</b> {plural(cluster.sources.length, "outlet")}
        </div>
        <span className="cluster__head__sep">·</span>
        <div className="cluster__readtime">{cluster.readMin} min read</div>
        <button
          className="cluster__expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Hide sources" : "View sources"}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="expanded">
          <div className="expanded__head">All coverage · {cluster.sources.length} sources</div>
          {cluster.sources.map((s, i) => (
            <a className="src-row" key={i} href={s.url} target="_blank" rel="noopener noreferrer">
              <SourceAvatar source={s} />
              <div className="src-row__src">{s.name}</div>
              <div className="src-row__head">{s.headline}</div>
              <div className="src-row__time">{hoursAgoLabel(s.hoursAgo)}</div>
            </a>
          ))}
        </div>
      )}

      {hover && <SourcePreview source={hover.source} x={hover.x} y={hover.y} />}
    </article>
  );
}
