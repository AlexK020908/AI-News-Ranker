import type { StoryBucket, StoryMember } from "@/lib/stories";
import type { StackCluster, StackSource } from "./types";
import { avatarFor, defaultThumbFor, hueFor } from "./sources";
import { topicForCluster } from "./topics";
import { getStorage } from "@/lib/storage/s3";

const WORDS_PER_MIN = 220;
const SUMMARY_MAX_CHARS = 180;
const CAVEMAN_MAX_CHARS = 240;

function truncateSentence(text: string, max: number): string {
  if (text.length <= max) return text;
  const truncated = text.slice(0, max);
  const lastSentence = truncated.search(/[.!?][^.!?]*$/);
  if (lastSentence > max * 0.5) return truncated.slice(0, lastSentence + 1);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? truncated.slice(0, lastSpace) : truncated) + "...";
}

function hoursAgoFrom(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  const h = (Date.now() - t) / 3_600_000;
  return Math.max(0, Math.round(h));
}

function estimateReadMin(summary: string | null | undefined): number {
  if (!summary) return 1;
  const words = summary.split(/\s+/).filter(Boolean).length;
  // Story bodies are short on the homepage but the synthesized summary is the
  // floor — clamp to [1, 8] so the value reads as "morning brief" not "long form".
  return Math.max(1, Math.min(8, Math.round(words / WORDS_PER_MIN)));
}

function thumbLabel(m: StoryMember): string {
  const candidate = m.summary?.trim() || m.title;
  if (!candidate) return m.source_name;
  // Limit to a short headline-ish phrase; the gradient panel can't fit more.
  const trimmed = candidate.replace(/\s+/g, " ").trim();
  return trimmed.length <= 64 ? trimmed : trimmed.slice(0, 60).replace(/\s+\S*$/, "") + "…";
}

// Image-URL resolution order:
//   1. S3 (durable, hotlink-safe) — set when the enrich step uploaded.
//   2. thumb_url — original publisher CDN URL captured during ingest.
//   3. Per-source default thumb (e.g. /source-thumbs/arxiv.svg) — used for
//      sources whose pages don't carry per-item images (arxiv papers all
//      look the same to og:image; HF model pages share a generic site card).
//   4. null — the renderer falls back to the gradient + headline panel.
function resolveImageUrl(m: StoryMember): string | null {
  if (m.s3_storage_id) {
    const url = getStorage().publicUrl(m.s3_storage_id);
    if (url) return url;
  }
  if (m.thumb_url) return m.thumb_url;
  return defaultThumbFor(m.source_slug);
}

// Techmeme titles end with "(Author/Publisher)". For old items that pre-date
// the ingestion fix, parse at display time so they also show the real outlet.
function parseTrailingAttribution(title: string): {
  cleanTitle: string;
  publisherName: string | null;
  publisherSlug: string | null;
} {
  const m = title.match(/\s*\(([^)]+)\)\s*$/);
  if (!m) return { cleanTitle: title, publisherName: null, publisherSlug: null };
  const cleanTitle = title.slice(0, m.index!).trim();
  const parts = m[1].trim().split(/\s*\/\s*/);
  const author = parts.length > 1 ? parts[0] : null;
  const publisher = parts[parts.length - 1];
  const slug = publisher.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const name = author ? `${publisher} (${author})` : publisher;
  return { cleanTitle, publisherName: name, publisherSlug: slug };
}

const AGGREGATOR_SLUGS = new Set(["techmeme"]);

function memberToSource(m: StoryMember): StackSource {
  let displaySlug = m.source_slug;
  let displayName = m.source_name;
  let headline = m.title;

  if (m.publisher_name && m.publisher_slug) {
    displaySlug = m.publisher_slug;
    displayName = m.publisher_name;
  } else if (AGGREGATOR_SLUGS.has(m.source_slug)) {
    const attr = parseTrailingAttribution(m.title);
    if (attr.publisherName) {
      displaySlug = attr.publisherSlug!;
      displayName = attr.publisherName;
      headline = attr.cleanTitle;
    }
  }

  const avatar = avatarFor(displaySlug, displayName);
  return {
    id: m.id,
    url: m.url,
    initial: avatar.initial,
    name: displayName,
    color: avatar.color,
    text: avatar.text,
    headline,
    hoursAgo: hoursAgoFrom(m.published_at),
    thumb: {
      hue: hueFor(displaySlug),
      label: thumbLabel(m),
      imageUrl: resolveImageUrl(m),
    },
    cavemanSummary: m.caveman_summary ?? null,
  };
}

export function clusterFromBucket(b: StoryBucket, risingIds?: ReadonlySet<string>): StackCluster {
  const sources = b.members.map(memberToSource);
  // Use the freshest member time as the cluster's hoursAgo — last_updated_at
  // reflects when the cluster row itself was touched by the job, which isn't
  // what a reader wants to see.
  const newestMs = b.members
    .map((m) => (m.published_at ? Date.parse(m.published_at) : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const newestIso = newestMs > 0 ? new Date(newestMs).toISOString() : b.last_updated_at;

  const rising = risingIds ? b.members.some((m) => risingIds.has(m.id)) : false;
  const topic = topicForCluster(b.members.map((m) => m.category));

  // For paper-majority clusters: pick the caveman_summary from the highest-
  // importance paper member. Other members may have null caveman fields
  // (if Claude declined or the column hadn't been populated yet on backfill).
  let cavemanSummary: string | null = null;
  if (topic === "paper") {
    const paperMembers = b.members
      .filter((m) => m.category === "paper" && m.caveman_summary)
      .sort((a, c) => (c.importance ?? 0) - (a.importance ?? 0));
    const raw = paperMembers[0]?.caveman_summary ?? null;
    cavemanSummary = raw ? truncateSentence(raw, CAVEMAN_MAX_CHARS) : null;
  }

  return {
    id: b.topic_id,
    slug: b.topic_slug,
    topic,
    headline: b.topic_label,
    summary: truncateSentence(b.topic_summary ?? "", SUMMARY_MAX_CHARS),
    hoursAgo: hoursAgoFrom(newestIso),
    readMin: estimateReadMin(b.topic_summary),
    breaking: (b.max_importance ?? 0) >= 92,
    rising,
    sources,
    cavemanSummary,
  };
}
