import type { StoryBucket, StoryMember } from "@/lib/stories";
import type { StackCluster, StackSource } from "./types";
import { avatarFor, hueFor } from "./sources";
import { topicForCluster } from "./topics";

const WORDS_PER_MIN = 220;

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

function memberToSource(m: StoryMember): StackSource {
  const avatar = avatarFor(m.source_slug, m.source_name);
  return {
    id: m.id,
    url: m.url,
    initial: avatar.initial,
    name: m.source_name,
    color: avatar.color,
    text: avatar.text,
    headline: m.title,
    hoursAgo: hoursAgoFrom(m.published_at),
    thumb: { hue: hueFor(m.source_slug), label: thumbLabel(m) },
  };
}

export function clusterFromBucket(b: StoryBucket): StackCluster {
  const sources = b.members.map(memberToSource);
  // Use the freshest member time as the cluster's hoursAgo — last_updated_at
  // reflects when the cluster row itself was touched by the job, which isn't
  // what a reader wants to see.
  const newestMs = b.members
    .map((m) => (m.published_at ? Date.parse(m.published_at) : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const newestIso = newestMs > 0 ? new Date(newestMs).toISOString() : b.last_updated_at;

  return {
    id: b.topic_id,
    slug: b.topic_slug,
    topic: topicForCluster(b.members.map((m) => m.category)),
    headline: b.topic_label,
    summary: b.topic_summary ?? "",
    hoursAgo: hoursAgoFrom(newestIso),
    readMin: estimateReadMin(b.topic_summary),
    breaking: (b.max_importance ?? 0) >= 92,
    sources,
  };
}
