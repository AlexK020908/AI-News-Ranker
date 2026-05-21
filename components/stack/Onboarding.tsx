"use client";

import { useState } from "react";
import { STACK_TOPICS } from "@/lib/stack/topics";

interface Props {
  onDone: (interests?: string[]) => void;
  initial?: string[];
}

export function Onboarding({ onDone, initial }: Props) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(initial || ["news", "release", "model"]),
  );
  const toggle = (id: string) => {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const topics = STACK_TOPICS.filter((t) => t.id !== "all");
  return (
    <div className="onb-mask" onClick={() => onDone()}>
      <div className="onb" onClick={(e) => e.stopPropagation()}>
        <div>
          <div className="onb__eyebrow">Welcome to Stack</div>
          <h2 className="onb__title">
            Tech news,<br />bundled across every outlet.
          </h2>
        </div>
        <p className="onb__sub">
          We cluster stories by topic so you read each one <i>once</i> — not five
          times in five tabs. Pick what you care about and we&apos;ll tune your
          morning brief.
        </p>
        <div>
          <div className="onb__count" style={{ marginBottom: 10 }}>
            Choose your interests · {picked.size} selected
          </div>
          <div className="onb__topics">
            {topics.map((t) => (
              <button
                key={t.id}
                className="topic-chip"
                aria-pressed={picked.has(t.id)}
                onClick={() => toggle(t.id)}
              >
                <span className="topic-chip__check">✓</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="onb__footer">
          <button className="btn-link" onClick={() => onDone()}>Skip for now</button>
          <button
            className="btn-primary"
            disabled={picked.size === 0}
            onClick={() => onDone(Array.from(picked))}
          >
            Read my brief
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
