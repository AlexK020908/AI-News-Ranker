"use client";

import { useEffect, useRef, useState } from "react";
import type { BriefCitation } from "@/lib/briefs";

// Inline citation chip — the Google-AI-Overview move shared by /x and /brief.
// A [n] in a brief becomes this: a single source links straight out; a cluster
// of N posts opens a small flyout listing them. Falls back to a muted "[n]"
// when the model cited a number we have no source for.
//
// `variant` only tweaks copy/glyphs: "x" frames sources as posts on X, "news"
// frames them as article sources.
interface Props {
  n: number;
  citation: BriefCitation | undefined;
  variant?: "x" | "news";
}

export function CitationChip({ n, citation, variant = "x" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!citation || citation.posts.length === 0) {
    return <sup className="cite cite--dead">[{n}]</sup>;
  }

  const noun = variant === "x" ? "posts" : "sources";

  // Single source → direct link, no flyout needed.
  if (citation.posts.length === 1) {
    const p = citation.posts[0];
    const title = variant === "x" ? `@${p.handle} on X` : citation.label;
    return (
      <sup className="cite">
        <a href={p.url} target="_blank" rel="noopener noreferrer" title={title}>
          {n}
        </a>
      </sup>
    );
  }

  // Multiple posts → chip opens a flyout of all of them.
  return (
    <span className="cite cite--multi" ref={ref}>
      <button
        type="button"
        className="cite__btn"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={`${citation.posts.length} ${noun}`}
      >
        {n}<span className="cite__count">·{citation.posts.length}</span>
      </button>
      {open && (
        <span className="cite__flyout" role="menu">
          <span className="cite__flyout-head">{citation.label} · {citation.posts.length} {noun}</span>
          {citation.posts.map((p, i) => (
            <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="cite__flyout-item" role="menuitem">
              {variant === "x" ? `𝕏 @${p.handle}` : p.handle}
            </a>
          ))}
        </span>
      )}
    </span>
  );
}
