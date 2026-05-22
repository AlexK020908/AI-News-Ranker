"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/types";

interface Props {
  enabled: ReadonlySet<Category>;
  setEnabled: (next: Set<Category>) => void;
}

// Multi-select dropdown for choosing which item categories appear in the
// "All" view of the homepage. Pinned to the right side of the nav so
// power users can hide whole noise sources (e.g. uncheck "repo" when
// they don't want a wall of GitHub trending). Persisted to localStorage
// by the parent.
export function TopicFilterDropdown({ enabled, setEnabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape. Listeners are scoped to the open
  // state so we don't pay for them when the menu is closed.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const toggle = (c: Category) => {
    const next = new Set(enabled);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setEnabled(next);
  };

  const hidden = CATEGORIES.length - enabled.size;
  const allOn  = hidden === 0;

  return (
    <div className="topic-filter" ref={ref}>
      <button
        className={`topic-filter__btn${hidden > 0 ? " has-filter" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Filter topics shown on All"
        aria-label="Filter topics"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M2 3h10M3.5 7h7M5 11h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="topic-filter__btn-label">
          {allOn ? "Topics" : `Topics · ${enabled.size}/${CATEGORIES.length}`}
        </span>
      </button>

      {open && (
        <div className="topic-filter__menu" role="dialog" aria-label="Topic filter">
          <div className="topic-filter__head">
            <span className="topic-filter__title">Show on All</span>
            <div className="topic-filter__bulk">
              <button
                type="button"
                onClick={() => setEnabled(new Set(CATEGORIES))}
                disabled={allOn}
              >
                Select all
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setEnabled(new Set())}
                disabled={enabled.size === 0}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="topic-filter__list">
            {CATEGORIES.map((c) => (
              <label key={c} className="topic-filter__item">
                <input
                  type="checkbox"
                  checked={enabled.has(c)}
                  onChange={() => toggle(c)}
                />
                <span>{CATEGORY_LABELS[c]}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
