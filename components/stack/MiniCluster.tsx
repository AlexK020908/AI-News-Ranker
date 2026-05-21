"use client";

import type { StackCluster } from "@/lib/stack/types";
import { STACK_TOPICS } from "@/lib/stack/topics";
import { hoursAgoLabel } from "@/lib/stack/format";
import { SourceAvatar } from "./SourceAvatar";

interface Props {
  cluster: StackCluster;
  onOpen: (id: string) => void;
  index?: number;
}

export function MiniCluster({ cluster, onOpen, index }: Props) {
  const topic = STACK_TOPICS.find((t) => t.id === cluster.topic);
  const lead = cluster.sources[0];
  if (!lead) return null;
  return (
    <article
      className="mini"
      style={{ animationDelay: `${(index || 0) * 60}ms` }}
      onClick={() => onOpen(cluster.id)}
    >
      <div className="mini__thumb">
        <div
          className="thumb__layer on"
          style={{
            background: `linear-gradient(140deg,
              oklch(0.48 0.16 ${lead.thumb.hue}) 0%,
              oklch(0.32 0.14 ${lead.thumb.hue + 25}) 55%,
              oklch(0.18 0.10 ${lead.thumb.hue + 50}) 100%)`,
          }}
        >
          <div className="thumb__source">{lead.name}</div>
          <div className="thumb__label">{lead.thumb.label}</div>
        </div>
      </div>
      <div className="mini__body">
        <div>
          <div className="mini__head">
            <span className="mini__topic">{topic?.label}</span>
            <span className="mini__sep">·</span>
            <span>{hoursAgoLabel(cluster.hoursAgo)}</span>
            {cluster.breaking && (
              <>
                <span className="mini__sep">·</span>
                <span style={{ color: "var(--accent)" }}>Breaking</span>
              </>
            )}
          </div>
          <h3 className="mini__title" style={{ marginTop: 4 }}>{cluster.headline}</h3>
        </div>
        <div className="mini__foot">
          <div className="sources">
            {cluster.sources.slice(0, 3).map((s, i) => (
              <SourceAvatar key={i} source={s} small />
            ))}
          </div>
          <span>{cluster.sources.length} outlets</span>
        </div>
      </div>
    </article>
  );
}
