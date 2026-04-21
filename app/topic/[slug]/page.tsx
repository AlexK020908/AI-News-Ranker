import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { ChevronLeft, Flame, TrendingUp } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ItemCard } from "@/components/item-card";
import type { ItemWithSource, TopicSummary } from "@/lib/types";
import { truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TopicRow extends TopicSummary {
  first_seen_at: string;
  last_updated_at: string;
}

const loadTopic = cache(async (slug: string): Promise<TopicRow | null> => {
  if (!/^[a-z0-9-]{1,80}$/i.test(slug)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("topics")
    .select(
      `id, slug, label, summary, member_count, avg_importance, max_importance,
       trending_score, first_seen_at, last_updated_at`,
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return data as TopicRow;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const topic = await loadTopic(slug);
  if (!topic) return { title: "Topic not found — AI News Feed" };
  const title = `${topic.label} — AI News Feed`;
  const description = topic.summary ? truncate(topic.summary, 180) : undefined;
  return {
    title,
    description,
    openGraph: { title, description, type: "website", url: `/topic/${slug}` },
    twitter: { card: "summary", title, description },
  };
}

export default async function TopicDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const topic = await loadTopic(slug);
  if (!topic) notFound();

  const supabase = await createSupabaseServerClient();
  const items = await loadMembers(supabase, topic.id);

  const lastUpdated = formatDistanceToNowStrict(new Date(topic.last_updated_at), {
    addSuffix: true,
  });

  return (
    <article className="flex flex-col gap-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 self-start text-xs text-muted-fg hover:text-fg transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> back to feed
      </Link>

      <header className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs text-accent">
          <TrendingUp className="h-3.5 w-3.5" />
          <span className="label-caps">Trending topic</span>
          <span className="text-muted-fg/60">·</span>
          <span className="font-mono tabular-nums text-[11px] text-muted-fg">
            updated {lastUpdated}
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-[1.15]">
          {topic.label}
        </h1>
        {topic.summary && (
          <p className="text-base text-muted-fg leading-relaxed max-w-prose">
            {topic.summary}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Stat
            icon={<Flame className="h-3 w-3" />}
            label={`${topic.member_count} item${topic.member_count === 1 ? "" : "s"}`}
          />
          <Stat label={`avg ${Math.round(topic.avg_importance ?? 0)}`} />
          {topic.max_importance !== null && (
            <Stat label={`peak ${topic.max_importance}`} />
          )}
          <Stat label={`score ${Math.round(topic.trending_score)}`} />
        </div>
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-muted-fg">
          No items currently linked to this topic. It may have just been pruned.
        </p>
      ) : (
        <section className="flex flex-col gap-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </section>
      )}
    </article>
  );
}

function Stat({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card/60 px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted-fg">
      {icon}
      {label}
    </span>
  );
}

async function loadMembers(
  supabase: SupabaseClient,
  topicId: string,
): Promise<ItemWithSource[]> {
  try {
    const { data, error } = await supabase
      .from("topic_members")
      .select(
        `item:items!inner(
          id, source_id, external_id, url, title, author, content, content_hash,
          summary, category, tags, importance, duplicate_count,
          engagement_score, source_weight_sum, topic_size,
          paper_citations, paper_influential_citations, paper_tldr,
          published_at, ingested_at, enriched_at, enrich_error, duplicate_of,
          source:sources!inner(slug, name, kind)
        )`,
      )
      .eq("topic_id", topicId);

    if (error) {
      console.error("loadMembers error:", error.message);
      return [];
    }
    const rows = (data ?? []) as unknown as { item: ItemWithSource | null }[];
    const items = rows.map((r) => r.item).filter((x): x is ItemWithSource => x !== null);
    items.sort((a, b) => {
      const ia = a.importance ?? 0;
      const ib = b.importance ?? 0;
      if (ib !== ia) return ib - ia;
      const ta = new Date(a.published_at ?? a.ingested_at).getTime();
      const tb = new Date(b.published_at ?? b.ingested_at).getTime();
      return tb - ta;
    });
    return items;
  } catch (err) {
    console.error("loadMembers exception:", err);
    return [];
  }
}
