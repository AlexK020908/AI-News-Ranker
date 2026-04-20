import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ItemCard } from "@/components/item-card";
import { FilterBar } from "@/components/filter-bar";
import { EmptyState } from "@/components/empty-state";
import { SetupBanner } from "@/components/setup-banner";
import { CATEGORIES, type Category, type ItemWithSource } from "@/lib/types";

// Always render on request — feed is dynamic.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface HomePageProps {
  searchParams: Promise<{
    sort?: string;
    cat?: string;
    min?: string;
  }>;
}

export default async function Home({ searchParams }: HomePageProps) {
  const sp = await searchParams;

  const sort: "hot" | "new" = sp.sort === "hot" ? "hot" : "new";
  const cat =
    sp.cat && (CATEGORIES as readonly string[]).includes(sp.cat)
      ? (sp.cat as Category)
      : null;
  const min = Math.max(0, Math.min(100, Number(sp.min) || 0));

  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseConfigured) {
    return (
      <>
        <HeroStats items={0} sources={0} />
        <SetupBanner />
      </>
    );
  }

  const items = await loadItems({ sort, cat, min });
  const sourceCount = await loadSourceCount();

  return (
    <>
      <HeroStats items={items.length} sources={sourceCount} />
      <FilterBar activeCategory={cat} activeSort={sort} minImportance={min} />
      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}

async function loadItems(opts: {
  sort: "hot" | "new";
  cat: Category | null;
  min: number;
}): Promise<ItemWithSource[]> {
  try {
    const supabase = await createSupabaseServerClient();
    let query = supabase
      .from("items")
      .select(
        `id, source_id, external_id, url, title, author, content, content_hash,
         summary, category, tags, importance, published_at, ingested_at,
         enriched_at, enrich_error,
         source:sources!inner(slug, name, kind)`,
      )
      .not("enriched_at", "is", null)
      .limit(60);

    if (opts.cat) query = query.eq("category", opts.cat);
    if (opts.min > 0) query = query.gte("importance", opts.min);

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

async function loadSourceCount(): Promise<number> {
  try {
    const supabase = await createSupabaseServerClient();
    const { count } = await supabase
      .from("sources")
      .select("id", { count: "exact", head: true })
      .eq("enabled", true);
    return count ?? 0;
  } catch {
    return 0;
  }
}

function HeroStats({ items, sources }: { items: number; sources: number }) {
  return (
    <section className="mb-6">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
        What's actually happening in AI — right now.
      </h1>
      <p className="mt-1.5 text-sm text-muted-fg">
        Papers, models, open-source drops, funding, and announcements — ranked, summarized,
        and pushed live. {sources > 0 ? `${sources} sources` : ""}
        {sources > 0 && items > 0 ? ` · ${items} shown` : ""}
      </p>
    </section>
  );
}
