"use client";

import type { RisingStandalone } from "@/lib/stack/rising-transform";

interface Props {
  items: RisingStandalone[];
}

function velocityLabel(v: number): string {
  if (v >= 100) return `+${Math.round(v)}/h`;
  if (v >= 10) return `+${v.toFixed(0)}/h`;
  return `+${v.toFixed(1)}/h`;
}

// A compact horizontal strip of rising items that don't belong to any
// multi-source cluster. These would otherwise be invisible on the
// homepage — they're single hot repos / threads / posts whose score is
// climbing fast in the snapshot window. The strip is read-only and
// links straight out to the source.
export function RisingStrip({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <section className="rising-strip" aria-label="Rising right now">
      <div className="rising-strip__head">
        <span aria-hidden="true">🔥</span>
        <span>Rising right now</span>
        <span className="rising-strip__hint">
          single hot items, not yet clustered
        </span>
      </div>
      <div className="rising-strip__row">
        {items.map((it) => (
          <a
            key={it.id}
            className="rising-card"
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ borderColor: `oklch(0.55 0.12 ${it.source.hue})` }}
          >
            <div className="rising-card__head">
              <span
                className="rising-card__avatar"
                style={{ background: it.source.color, color: it.source.text || "#fff" }}
              >
                {it.source.initial}
              </span>
              <span className="rising-card__source">{it.source.name}</span>
              <span className="rising-card__velocity" title={`delta=${it.delta} over ${it.hours.toFixed(1)}h`}>
                {velocityLabel(it.velocity)}
              </span>
            </div>
            <div className="rising-card__title">{it.title}</div>
            {it.summary && <div className="rising-card__summary">{it.summary}</div>}
          </a>
        ))}
      </div>
    </section>
  );
}
