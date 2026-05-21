"use client";

import { STACK_TOPICS } from "@/lib/stack/topics";

interface Props {
  topic: string;
  setTopic: (id: string) => void;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  onLogo: () => void;
  onShowOnb: () => void;
  scrolled: boolean;
}

export function Nav({ topic, setTopic, theme, setTheme, onLogo, onShowOnb, scrolled }: Props) {
  return (
    <nav className={`nav${scrolled ? " scrolled" : ""}`}>
      <div className="nav__inner">
        <div className="brand" onClick={onLogo}>
          <span className="brand__mark">S</span>
          <span className="brand__name">stack<span className="brand__dot">.</span></span>
        </div>
        <div className="nav__pills">
          {STACK_TOPICS.map((t) => (
            <button
              key={t.id}
              className="pill"
              aria-pressed={topic === t.id}
              onClick={() => setTopic(t.id)}
            >
              <span className="pill__dot" />
              {t.label}
            </button>
          ))}
        </div>
        <div className="nav__actions">
          <button className="icon-btn" title="Search" aria-label="Search">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <button className="icon-btn" title="Edit interests" onClick={onShowOnb} aria-label="Interests">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5l1.8 4.2L14 6.3l-3.2 2.8.9 4.4L8 11.4l-3.7 2.1.9-4.4L2 6.3l4.2-.6L8 1.5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            className="icon-btn"
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Theme"
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M13 9a5 5 0 1 1-6-6 4 4 0 0 0 6 6z" fill="currentColor" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3" fill="currentColor" />
                <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M3.2 12.8l1.4-1.4M11.4 4.6l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </nav>
  );
}
