"use client";

import type { StackCluster } from "@/lib/stack/types";
import { STACK_TOPICS } from "@/lib/stack/topics";
import { hoursAgoLabel } from "@/lib/stack/format";
import { SourceAvatar } from "./SourceAvatar";

interface Props {
  cluster: StackCluster;
  onBack: () => void;
}

export function ClusterDetail({ cluster, onBack }: Props) {
  const topic = STACK_TOPICS.find((t) => t.id === cluster.topic);
  return (
    <div>
      <div className="crumb">
        <button onClick={onBack}>← Briefing</button>
        <span className="crumb__sep">/</span>
        <span style={{ color: "var(--accent)" }}>{topic?.label}</span>
        <span className="crumb__sep">/</span>
        <span>Cluster</span>
      </div>

      <div className="detail-head">
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
        </div>

        <h1 className="detail-title">{cluster.headline}</h1>

        <p className="detail-summary">{cluster.summary}</p>

        <div className="detail-strip">
          <div className="sources">
            {cluster.sources.map((s, i) => (
              <SourceAvatar key={i} source={s} />
            ))}
          </div>
          <div className="cluster__count">
            Synthesized from <b>{cluster.sources.length}</b> sources
          </div>
          <span className="cluster__head__sep">·</span>
          <div className="cluster__readtime">{cluster.readMin} min read</div>
        </div>
      </div>

      <div className="detail-section-title">Every angle, every source</div>

      <div className="detail-grid">
        {cluster.sources.map((s, i) => (
          <a
            className="story"
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <div className="story__thumb">
              <div
                className="thumb__layer on"
                style={{
                  background: `linear-gradient(140deg,
                    oklch(0.48 0.16 ${s.thumb.hue}) 0%,
                    oklch(0.32 0.14 ${s.thumb.hue + 25}) 55%,
                    oklch(0.18 0.10 ${s.thumb.hue + 50}) 100%)`,
                }}
              >
                <div className="thumb__source">{s.name}</div>
                <div className="thumb__label">{s.thumb.label}</div>
              </div>
            </div>
            <div className="story__src">
              <SourceAvatar source={s} small />
              <span>{s.name}</span>
            </div>
            <h3 className="story__head">{s.headline}</h3>
            <div className="story__meta">
              <span>{hoursAgoLabel(s.hoursAgo)}</span>
              <span>Read →</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
