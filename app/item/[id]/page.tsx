import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "next/link";
import { ArrowUpRight, ChevronLeft } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { importanceTier } from "@/components/item-card";
import { CATEGORY_LABELS, type Category, type SourceKind } from "@/lib/types";
import { cn, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RELATED_THRESHOLD = 0.75;
const RELATED_COUNT = 6;
const RELATED_WINDOW_HOURS = 24 * 30;

interface DetailRow {
  id: string;
  title: string;
  url: string;
  author: string | null;
  content: string | null;
  summary: string | null;
  category: Category | null;
  tags: string[] | null;
  importance: number | null;
  embedding: number[] | null;
  duplicate_of: string | null;
  published_at: string | null;
  ingested_at: string;
  enriched_at: string | null;
  source: { slug: string; name: string; kind: SourceKind };
}

interface RelatedRow {
  id: string;
  title: string;
  importance: number | null;
  published_at: string | null;
  category: Category | null;
  source: { slug: string; name: string };
}

interface CollapsedRow {
  id: string;
  url: string;
  title: string;
  published_at: string | null;
  source: { slug: string; name: string };
}

const loadItem = cache(async (id: string): Promise<DetailRow | null> => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("items")
    .select(
      `id, title, url, author, content, summary, category, tags, importance,
       embedding, duplicate_of, published_at, ingested_at, enriched_at,
       source:sources!inner(slug, name, kind)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as DetailRow;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const item = await loadItem(id);
  if (!item) return { title: "Not found — AI News Feed" };
  const title = `${item.title} — AI News Feed`;
  const description = item.summary ? truncate(item.summary, 180) : undefined;
  return {
    title,
    description,
    openGraph: { title, description, type: "article", url: `/item/${id}` },
    twitter: { card: "summary", title, description },
  };
}

export default async function ItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = await loadItem(id);
  if (!item || !item.enriched_at) notFound();

  const supabase = await createSupabaseServerClient();
  const [related, collapsed] = await Promise.all([
    loadRelated(supabase, item.id, item.embedding),
    loadCollapsed(supabase, item.id),
  ]);

  const imp = importanceTier(item.importance ?? 0);
  const when = new Date(item.published_at ?? item.ingested_at);
  const rel = formatDistanceToNowStrict(when, { addSuffix: true });
  const paragraphs = splitParagraphs(item.content);

  return (
    <article className="flex flex-col gap-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 self-start text-xs text-muted-fg hover:text-fg transition-colors"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> back to feed
      </Link>

      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-fg">
          <span className="label-caps text-fg/90">{item.source.name}</span>
          {item.category && (
            <>
              <span className="text-muted-fg/40">·</span>
              <span className="rounded-md border border-border bg-bg/40 px-1.5 py-0.5 label-caps text-muted-fg">
                {CATEGORY_LABELS[item.category]}
              </span>
            </>
          )}
          <span className="text-muted-fg/40">·</span>
          <time
            dateTime={when.toISOString()}
            className="font-mono tabular-nums text-[11px]"
          >
            {rel}
          </time>
          {item.author && (
            <>
              <span className="text-muted-fg/40">·</span>
              <span className="text-[11px]">by {item.author}</span>
            </>
          )}
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
              imp.badge,
            )}
            title={`Importance ${item.importance ?? 0}/100`}
          >
            {item.importance ?? 0}
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-[1.15]">
          {item.title}
        </h1>

        {item.summary && (
          <p className="text-base text-muted-fg leading-relaxed max-w-prose">
            {item.summary}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {item.tags?.slice(0, 12).map((t) => (
            <span
              key={t}
              className="rounded bg-bg/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-fg ring-1 ring-border"
            >
              #{t}
            </span>
          ))}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-fg transition-colors hover:border-border-strong hover:bg-card-raised"
          >
            Open source <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </header>

      {paragraphs.length > 0 && (
        <section className="flex flex-col gap-4 border-t border-border pt-6 text-[15px] leading-relaxed text-fg/90 max-w-prose">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      )}

      {collapsed.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border pt-6">
          <h2 className="label-caps text-muted-fg">
            Also reported by {collapsed.length} source{collapsed.length === 1 ? "" : "s"}
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card/40">
            {collapsed.map((c) => (
              <li key={c.id}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-card"
                >
                  <span className="label-caps shrink-0 text-fg/90">
                    {c.source.name}
                  </span>
                  <span className="truncate text-muted-fg">{c.title}</span>
                  <ArrowUpRight className="ml-auto h-3 w-3 shrink-0 text-muted-fg" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-border pt-6">
          <h2 className="label-caps text-muted-fg">Related</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {related.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/item/${r.id}`}
                  className="flex flex-col gap-1 rounded-lg border border-border bg-card/60 p-3 transition-colors hover:border-border-strong hover:bg-card-raised"
                >
                  <div className="flex items-center gap-2 text-[11px] text-muted-fg">
                    <span className="label-caps text-fg/90">{r.source.name}</span>
                    {r.category && (
                      <>
                        <span className="text-muted-fg/40">·</span>
                        <span className="label-caps">{CATEGORY_LABELS[r.category]}</span>
                      </>
                    )}
                    <span className="ml-auto font-mono tabular-nums">
                      {r.importance ?? 0}
                    </span>
                  </div>
                  <p className="text-sm leading-snug text-fg line-clamp-2">
                    {r.title}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

async function loadRelated(
  supabase: SupabaseClient,
  itemId: string,
  embedding: number[] | null,
): Promise<RelatedRow[]> {
  if (!embedding) return [];
  try {
    const { data: matches, error } = await supabase.rpc("similar_recent_items", {
      query_embedding: embedding,
      match_threshold: RELATED_THRESHOLD,
      match_count: RELATED_COUNT + 1,
      since_hours: RELATED_WINDOW_HOURS,
    });
    if (error) {
      console.error("loadRelated rpc:", error.message);
      return [];
    }
    const rawIds = (matches as { id: string }[] | null) ?? [];
    const ids = rawIds.map((m) => m.id).filter((id) => id !== itemId).slice(0, RELATED_COUNT);
    if (ids.length === 0) return [];
    const { data, error: e2 } = await supabase
      .from("items")
      .select(
        `id, title, importance, published_at, category,
         source:sources!inner(slug, name)`,
      )
      .in("id", ids);
    if (e2) {
      console.error("loadRelated fetch:", e2.message);
      return [];
    }
    const rows = (data ?? []) as unknown as RelatedRow[];
    const order = new Map(ids.map((id, i) => [id, i]));
    return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  } catch (err) {
    console.error("loadRelated exception:", err);
    return [];
  }
}

async function loadCollapsed(
  supabase: SupabaseClient,
  itemId: string,
): Promise<CollapsedRow[]> {
  try {
    const { data, error } = await supabase
      .from("items")
      .select(
        `id, url, title, published_at,
         source:sources!inner(slug, name)`,
      )
      .eq("duplicate_of", itemId)
      .order("published_at", { ascending: false, nullsFirst: false });
    if (error) {
      console.error("loadCollapsed:", error.message);
      return [];
    }
    return (data ?? []) as unknown as CollapsedRow[];
  } catch {
    return [];
  }
}

function splitParagraphs(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
