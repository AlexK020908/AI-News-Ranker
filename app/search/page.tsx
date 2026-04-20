import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import { sanitizeIlike } from "@/lib/utils";
import type { ItemWithSource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LIMIT = 60;

interface SearchPageProps {
  searchParams: Promise<{ q?: string }>;
}

export default async function Search({ searchParams }: SearchPageProps) {
  const sp = await searchParams;
  const q = sanitizeIlike(typeof sp.q === "string" ? sp.q : "");

  if (q.length < 2) {
    return (
      <section className="flex flex-col gap-6">
        <Header query={q} />
        <EmptyState
          title="Type at least 2 characters"
          description="Search across titles, summaries, and tags from every enriched item."
        />
      </section>
    );
  }

  const supabase = await createSupabaseServerClient();
  const items = await runSearch(supabase, q);

  return (
    <section className="flex flex-col gap-6">
      <Header query={q} count={items.length} />
      {items.length === 0 ? (
        <EmptyState
          title="No matches"
          description={`Nothing enriched matches "${q}" right now. Try a broader term.`}
        />
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

async function runSearch(
  supabase: SupabaseClient,
  q: string,
): Promise<ItemWithSource[]> {
  try {
    const pattern = `%${q}%`;
    // tags.cs.{val} takes a PG array literal; multi-word queries don't have a
    // sane single-element form, so gate the tag arm on single-token queries.
    const arms = [`title.ilike.${pattern}`, `summary.ilike.${pattern}`];
    if (!/\s/.test(q)) arms.push(`tags.cs.{${q}}`);
    const { data, error } = await supabase
      .from("items")
      .select(
        `id, url, title, summary, category, tags, importance,
         published_at, ingested_at,
         source:sources!inner(slug, name, kind)`,
      )
      .not("enriched_at", "is", null)
      .is("duplicate_of", null)
      .or(arms.join(","))
      .order("importance", { ascending: false, nullsFirst: false })
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(LIMIT);
    if (error) {
      console.error("search error:", error.message);
      return [];
    }
    return (data ?? []) as unknown as ItemWithSource[];
  } catch (err) {
    console.error("search exception:", err);
    return [];
  }
}

function Header({ query, count }: { query: string; count?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-caps text-accent">Search</span>
      <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">
        {query ? `Results for "${query}"` : "Search the feed"}
      </h1>
      {typeof count === "number" && (
        <p className="text-xs text-muted-fg">
          {count} {count === 1 ? "match" : "matches"} · enriched, non-duplicates only
        </p>
      )}
    </div>
  );
}
