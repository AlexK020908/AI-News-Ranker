"use client";

import { useEffect, useState, type MouseEvent } from "react";
import type { StackSource } from "@/lib/stack/types";

interface Props {
  sources: StackSource[];
  paused?: boolean;
}

export function RotatingThumb({ sources, paused }: Props) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (paused || sources.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % sources.length), 4200);
    return () => clearInterval(t);
  }, [sources.length, paused]);

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setIdx((i) => (i + 1) % sources.length);
  };

  return (
    <div className="thumb" onClick={handleClick}>
      {sources.map((s, i) => {
        const hue = s.thumb.hue;
        return (
          <div
            key={i}
            className={`thumb__layer ${i === idx ? "on" : ""}`}
            style={{
              background: `linear-gradient(140deg,
                oklch(0.48 0.16 ${hue}) 0%,
                oklch(0.32 0.14 ${hue + 25}) 55%,
                oklch(0.18 0.10 ${hue + 50}) 100%)`,
            }}
          >
            <div className="thumb__source">{s.name}</div>
            <div className="thumb__label">{s.thumb.label}</div>
          </div>
        );
      })}
      <div className="thumb__dots">
        {sources.map((_, i) => (
          <span key={i} className={i === idx ? "on" : ""} />
        ))}
      </div>
    </div>
  );
}
