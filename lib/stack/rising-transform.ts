import type { RisingItem } from "@/lib/rising";
import { avatarFor, hueFor } from "./sources";

// A flat shape designed for a strip of "look at this single hot item"
// cards on the homepage. Standalone rising items aren't part of any
// topic cluster, so they have no headline beyond their own title and no
// sibling outlets.
export interface RisingStandalone {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  category: string | null;
  importance: number | null;
  delta: number;            // raw point/star gain over the window
  hours: number;            // observation window length in hours
  velocity: number;         // delta / max(hours, 0.5)
  hoursAgo: number;         // since published_at
  source: {
    slug: string;
    name: string;
    kind: string;
    initial: string;
    color: string;
    text?: string;
    hue: number;
  };
}

function hoursAgoFrom(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 3_600_000));
}

export function risingItemToStandalone(r: RisingItem): RisingStandalone {
  const avatar = avatarFor(r.source_slug, r.source_name);
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    summary: r.summary,
    category: r.category,
    importance: r.importance,
    delta: r.delta,
    hours: r.hours,
    velocity: r.velocity,
    hoursAgo: hoursAgoFrom(r.published_at),
    source: {
      slug: r.source_slug,
      name: r.source_name,
      kind: r.source_kind,
      initial: avatar.initial,
      color: avatar.color,
      text: avatar.text,
      hue: hueFor(r.source_slug),
    },
  };
}
