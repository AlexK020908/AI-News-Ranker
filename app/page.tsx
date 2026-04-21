import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FilterBar } from "@/components/filter-bar";
import { SetupBanner } from "@/components/setup-banner";
import { Feed, type SourceMap } from "@/components/feed";
import { TopicsStrip } from "@/components/topics-strip";
import { WebhookSignup } from "@/components/webhook-signup";
import {
  isCategory,
  isSortMode,
  isSourceGroup,
  kindsFor,
  type Category,
  type ItemWithSource,
  type SortMode,
  type SourceGroup,
  type SourceKind,
  type TopicSummary,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface HomePageProps {
  searchParams: Promise<{
    sort?: string;
    cat?: string;
    min?: string;
    src?: string;
  }>;
}

export default async function Home({ searchParams }: HomePageProps) {
  const sp = await searchParams;

  const sort: SortMode = isSortMode(sp.sort) ? sp.sort : "new";
  const cat: Category | null = isCategory(sp.cat) ? sp.cat : null;
  const min = Math.max(0, Math.min(100, Number(sp.min) || 0));
  const src: SourceGroup | null = isSourceGroup(sp.src) ? sp.src : null;

  if (!isSupabaseConfigured()) {
    return (
      <>
        <Hero items={0} sources={0} />
        <SetupBanner />
      </>
    );
  }

  const supabase = await createSupabaseServerClient();
  const [items, sources, topics] = await Promise.all([
    loadItems(supabase, { sort, cat, min, src }),
    loadSources(supabase),
    loadTopTopics(supabase),
  ]);
  const sourceMap = toSourceMap(sources);

  return (
    <>
      <Hero items={items.length} sources={sources.length} />
      <TopicsStrip topics={topics} />
      <WebhookSignup />
      <FilterBar
        activeCategory={cat}
        activeSort={sort}
        minImportance={min}
        activeSourceGroup={src}
      />
      <Feed initialItems={items} sources={sourceMap} filter={{ sort, cat, min, src }} />
    </>
  );
}

async function loadTopTopics(supabase: SupabaseClient): Promise<TopicSummary[]> {
  try {
    const { data, error } = await supabase.rpc("top_topics", { max_rows: 10 });
    if (error) {
      console.error("top_topics rpc:", error.message);
      return [];
    }
    return (data ?? []) as TopicSummary[];
  } catch (err) {
    console.error("loadTopTopics exception:", err);
    return [];
  }
}

function isSupabaseConfigured() {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

interface SourceRow {
  id: string;
  slug: string;
  name: string;
  kind: SourceKind;
}

interface LoadOpts {
  sort: SortMode;
  cat: Category | null;
  min: number;
  src: SourceGroup | null;
}

async function loadItems(
  supabase: SupabaseClient,
  opts: LoadOpts,
): Promise<ItemWithSource[]> {
  try {
    if (opts.sort === "trending") {
      return await loadTrendingItems(supabase, opts);
    }

    const kinds = kindsFor(opts.src);
    let query = supabase
      .from("items")
      .select(
        `id, source_id, external_id, url, title, author, content, content_hash,
         summary, category, tags, importance, duplicate_count,
         engagement_score, source_weight_sum, topic_size,
         paper_citations, paper_influential_citations, paper_tldr,
         published_at, ingested_at, enriched_at, enrich_error, duplicate_of,
         source:sources!inner(slug, name, kind)`,
      )
      .not("enriched_at", "is", null)
      .is("duplicate_of", null)
      .limit(60);

    if (opts.cat) query = query.eq("category", opts.cat);
    if (opts.min > 0) query = query.gte("importance", opts.min);
    if (kinds) query = query.in("source.kind", kinds);

    if (opts.sort === "hot") {
      query = query.order("importance", { ascending: false, nullsFirst: false });
      query = query.order("published_at", { ascending: false, nullsFirst: false });
    } else {
      query = query.order("published_at", { ascending: false, nullsFirst: false });
    }

    const { data, error } = await query;
    if (error) {
      console.error("loadItems error:", error.message);
      return [];
    }
    return (data ?? []) as unknown as ItemWithSource[];
  } catch (err) {
    console.error("loadItems exception:", err);
    return [];
  }
}

async function loadTrendingItems(
  supabase: SupabaseClient,
  opts: LoadOpts,
): Promise<ItemWithSource[]> {
  const kinds = kindsFor(opts.src);
  const { data: scored, error } = await supabase.rpc("trending_items", {
    min_importance: opts.min,
    cat: opts.cat,
    source_kinds: kinds,
    max_rows: 60,
  });
  if (error) {
    console.error("trending_items rpc error:", error.message);
    return [];
  }
  const rows = (scored ?? []) as Array<{ id: string; source_id: string }>;
  if (rows.length === 0) return [];

  const sourceIds = Array.from(new Set(rows.map((r) => r.source_id)));
  const { data: sources, error: srcErr } = await supabase
    .from("sources")
    .select("id, slug, name, kind")
    .in("id", sourceIds);
  if (srcErr) {
    console.error("trending sources hydrate error:", srcErr.message);
    return [];
  }
  const srcById = new Map((sources ?? []).map((s) => [s.id as string, s]));

  return rows
    .map((row) => {
      const src = srcById.get(row.source_id);
      if (!src) return null;
      return { ...row, source: { slug: src.slug, name: src.name, kind: src.kind } };
    })
    .filter(Boolean) as unknown as ItemWithSource[];
}

async function loadSources(supabase: SupabaseClient): Promise<SourceRow[]> {
  try {
    const { data, error } = await supabase
      .from("sources")
      .select("id, slug, name, kind")
      .eq("enabled", true);
    if (error) {
      console.error("loadSources error:", error.message);
      return [];
    }
    return (data ?? []) as SourceRow[];
  } catch {
    return [];
  }
}

function toSourceMap(rows: SourceRow[]): SourceMap {
  const out: SourceMap = {};
  for (const r of rows) {
    out[r.id] = { slug: r.slug, name: r.name, kind: r.kind };
  }
  return out;
}

function Hero({ items, sources }: { items: number; sources: number }) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        <span className="label-caps text-accent">Live · realtime stream</span>
      </div>
      <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight leading-[1.1]">
        What&rsquo;s actually happening{" "}
        <span className="text-primary">in AI</span> — right now.
      </h1>
      <p className="mt-2.5 text-sm text-muted-fg max-w-2xl leading-relaxed">
        Papers, models, open-source drops, funding, and announcements — ranked, summarized,
        and pushed live.
      </p>
      {(sources > 0 || items > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          {sources > 0 && <Stat label="sources" value={sources} />}
          {items > 0 && <Stat label="shown" value={items} />}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/60 px-2.5 py-1 backdrop-blur-sm">
      <span className="font-mono tabular-nums font-semibold text-fg">{value}</span>
      <span className="label-caps text-muted-fg">{label}</span>
    </span>
  );
}
