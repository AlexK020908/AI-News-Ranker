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
        const hasImage = !!s.thumb.imageUrl;
        // X/Twitter posts almost never carry an og-image, so without this the
        // thumbnail is a bare gradient. Show the X logo as a watermark instead.
        const showXLogo = !!s.isX && !hasImage;
        return (
          <div
            key={i}
            className={`thumb__layer ${i === idx ? "on" : ""}${hasImage ? " thumb__layer--image" : ""}`}
            style={{
              background: `linear-gradient(140deg,
                oklch(0.48 0.16 ${hue}) 0%,
                oklch(0.32 0.14 ${hue + 25}) 55%,
                oklch(0.18 0.10 ${hue + 50}) 100%)`,
            }}
          >
            {showXLogo && (
              <svg
                className="thumb__xlogo"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            )}
            {hasImage && (
              <img
                className="thumb__image"
                src={s.thumb.imageUrl!}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  // Hotlinked image got blocked/404 — drop back to the gradient.
                  e.currentTarget.style.display = "none";
                  e.currentTarget.parentElement?.classList.remove("thumb__layer--image");
                }}
              />
            )}
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
