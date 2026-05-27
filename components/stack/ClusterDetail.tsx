"use client";

import { useState } from "react";
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
  const [copied, setCopied] = useState(false);

  const copyLink = () => {
    const url = `${window.location.origin}/topic/${cluster.slug}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

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
        </div>

        <h1 className="detail-title">{cluster.headline}</h1>

        {cluster.topic === "paper" && cluster.cavemanSummary && (
          <div className="cluster__caveman" style={{ margin: "12px 0" }}>
            <span className="cluster__caveman__label">CAVEMAN</span>
            <span className="cluster__caveman__body">{cluster.cavemanSummary}</span>
          </div>
        )}

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
          <span className="cluster__head__sep">·</span>
          <button
            className="cluster__share"
            onClick={copyLink}
            title="Copy link to this cluster"
          >
            {copied ? (
              <>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M3 7.5l2.5 2.5L11 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M8.5 3.5h-4a1 1 0 00-1 1v6a1 1 0 001 1h4a1 1 0 001-1v-6a1 1 0 00-1-1z" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M5.5 3.5v-1a1 1 0 011-1h4a1 1 0 011 1v6a1 1 0 01-1 1h-1" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                Share
              </>
            )}
          </button>
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
                className={`thumb__layer on${s.thumb.imageUrl ? " thumb__layer--image" : ""}`}
                style={{
                  background: `linear-gradient(140deg,
                    oklch(0.48 0.16 ${s.thumb.hue}) 0%,
                    oklch(0.32 0.14 ${s.thumb.hue + 25}) 55%,
                    oklch(0.18 0.10 ${s.thumb.hue + 50}) 100%)`,
                }}
              >
                {s.thumb.imageUrl && (
                  <img
                    className="thumb__image"
                    src={s.thumb.imageUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                      e.currentTarget.parentElement?.classList.remove("thumb__layer--image");
                    }}
                  />
                )}
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
