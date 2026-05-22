"use client";

import type { TrendingRepoCard } from "@/lib/stack/trending-repo-transform";

interface Props {
  items: TrendingRepoCard[];
  // Click handler for a topic chip — wires the chip into the parent's
  // filter state on /repos. Omit to render chips as static labels.
  onTopicClick?: (topic: string) => void;
  // Click handler for the language label.
  onLanguageClick?: (language: string) => void;
}

function formatStars(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000)   return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

// High-star solo GitHub repos that aren't yet members of any cluster.
// Sibling of RisingStrip — same visual language, different qualification
// rule: stars instead of score velocity. Reuses rising-* CSS classes to
// stay consistent without duplicating the design.
export function TrendingReposStrip({ items, onTopicClick, onLanguageClick }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="rising-strip" aria-label="Trending repos">
      <div className="rising-strip__head">
        <span aria-hidden="true">⭐</span>
        <span>Trending repos</span>
        <span className="rising-strip__hint">
          high-star repos, not yet clustered
        </span>
      </div>
      <div className="rising-strip__row">
        {items.map((it) => (
          <article
            key={it.id}
            className="rising-card repo-card"
            style={{ borderColor: `oklch(0.55 0.12 ${it.source.hue})` }}
          >
            <a
              className="repo-card__link"
              href={it.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <div className="rising-card__head">
                <span
                  className="rising-card__avatar"
                  style={{ background: it.source.color, color: it.source.text || "#fff" }}
                >
                  {it.source.initial}
                </span>
                <span className="rising-card__source">{it.source.name}</span>
                <span className="rising-card__velocity" title={`${it.stars.toLocaleString()} stars`}>
                  ⭐ {formatStars(it.stars)}
                </span>
              </div>
              <div className="rising-card__title">{it.title}</div>
              {it.summary && <div className="rising-card__summary">{it.summary}</div>}
            </a>
            {(it.language || it.topics.length > 0) && (
              <div className="repo-card__meta">
                {it.language && (
                  onLanguageClick ? (
                    <button
                      type="button"
                      className="repo-chip repo-chip--lang"
                      onClick={() => onLanguageClick(it.language!)}
                      title={`Filter by ${it.language}`}
                    >
                      {it.language}
                    </button>
                  ) : (
                    <span className="repo-chip repo-chip--lang">{it.language}</span>
                  )
                )}
                {it.topics.map((t) =>
                  onTopicClick ? (
                    <button
                      key={t}
                      type="button"
                      className="repo-chip"
                      onClick={() => onTopicClick(t)}
                      title={`Filter by ${t}`}
                    >
                      {t}
                    </button>
                  ) : (
                    <span key={t} className="repo-chip">{t}</span>
                  )
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
