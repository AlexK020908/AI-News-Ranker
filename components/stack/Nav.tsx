"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Category } from "@/lib/types";
import { STACK_TOPICS } from "@/lib/stack/topics";
import { TopicFilterDropdown } from "./TopicFilterDropdown";

interface Props {
  // Only used on the home page; ignored on dedicated routes.
  topic?: string;
  setTopic?: (id: string) => void;
  // Multi-select category filter for the "All" view. Only meaningful on
  // home; other routes ignore them.
  enabledCategories?: ReadonlySet<Category>;
  setEnabledCategories?: (next: Set<Category>) => void;
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  onLogo?: () => void;
  onShowOnb: () => void;
  // Open the SubscribeModal. The button only renders on routes where the
  // parent passes the handler — keeps standalone item/repo/search pages
  // free of CTAs that depend on home-page state.
  onShowSubscribe?: () => void;
  scrolled: boolean;
}

export function Nav({
  topic = "all",
  setTopic,
  enabledCategories,
  setEnabledCategories,
  theme,
  setTheme,
  onLogo,
  onShowOnb,
  onShowSubscribe,
  scrolled,
}: Props) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isRepos = pathname === "/repos";

  return (
    <nav className={`nav${scrolled ? " scrolled" : ""}`}>
      <div className="nav__inner">
        {isHome ? (
          <div className="brand" onClick={onLogo}>
            <span className="brand__mark">SB</span>
            <span className="brand__name">StackBrief<span className="brand__dot">.</span></span>
          </div>
        ) : (
          <Link href="/" className="brand">
            <span className="brand__mark">SB</span>
            <span className="brand__name">StackBrief<span className="brand__dot">.</span></span>
          </Link>
        )}

        <div className="nav__pills">
          {STACK_TOPICS.map((t) => {
            // On the home page, pills are filter buttons (no navigation).
            // On other routes, pills navigate back to / since topic state
            // only lives on the home cluster grid.
            if (isHome) {
              return (
                <button
                  key={t.id}
                  className="pill"
                  aria-pressed={topic === t.id}
                  onClick={() => setTopic?.(t.id)}
                >
                  <span className="pill__dot" />
                  {t.label}
                </button>
              );
            }
            return (
              <Link
                key={t.id}
                href="/"
                className="pill"
                aria-pressed={false}
              >
                <span className="pill__dot" />
                {t.label}
              </Link>
            );
          })}
        </div>

        {/* Repos link lives outside the scrollable pill rail so the mask
            gradient never clips it. Visually accented with the nav__link
            style to mark it as a destination, not a filter. */}
        <Link
          href="/repos"
          className={`nav__link${isRepos ? " is-active" : ""}`}
          aria-current={isRepos ? "page" : undefined}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 1h6l3 3v9H3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M9 1v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
          </svg>
          Repos
        </Link>

        <div className="nav__actions">
          {isHome && enabledCategories && setEnabledCategories && (
            <TopicFilterDropdown
              enabled={enabledCategories}
              setEnabled={setEnabledCategories}
            />
          )}
          {onShowSubscribe && (
            <button
              className="nav__cta"
              onClick={onShowSubscribe}
              aria-label="Subscribe"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M2 3h10v8H2z" stroke="currentColor" strokeWidth="1.4" />
                <path d="M2 3l5 4 5-4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
              <span className="nav__cta-label">Subscribe</span>
            </button>
          )}
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
