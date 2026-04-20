import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { ExternalLink } from "lucide-react";
import type { ItemWithSource } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ItemCard({ item }: { item: ItemWithSource }) {
  const published = item.published_at ?? item.ingested_at;
  const rel = published
    ? formatDistanceToNowStrict(new Date(published), { addSuffix: true })
    : null;
  const importance = item.importance ?? 0;

  return (
    <article className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-fg/20">
      <div className={cn("absolute left-0 top-0 h-1 w-full rounded-t-xl", importanceClass(importance))} />
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-fg pt-1">
        <span className="font-medium text-fg">{item.source.name}</span>
        {item.category && (
          <>
            <span className="opacity-40">·</span>
            <span className="rounded-full border border-border px-2 py-0.5">
              {CATEGORY_LABELS[item.category]}
            </span>
          </>
        )}
        {rel && (
          <>
            <span className="opacity-40">·</span>
            <span>{rel}</span>
          </>
        )}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono tabular-nums">
          {importance}
        </span>
      </div>

      <h2 className="text-base sm:text-lg font-semibold leading-snug tracking-tight">
        <Link
          href={`/item/${item.id}`}
          className="after:absolute after:inset-0 after:content-['']"
        >
          {item.title}
        </Link>
      </h2>

      {item.summary && (
        <p className="text-sm text-muted-fg leading-relaxed">{item.summary}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-fg">
        {item.tags?.slice(0, 4).map((t) => (
          <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 font-mono">
            {t}
          </span>
        ))}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="relative z-10 ml-auto inline-flex items-center gap-1 hover:text-fg"
          onClick={(e) => e.stopPropagation()}
        >
          source <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </article>
  );
}

function importanceClass(n: number): string {
  if (n >= 95) return "importance-95";
  if (n >= 85) return "importance-85";
  if (n >= 70) return "importance-70";
  if (n >= 50) return "importance-50";
  if (n >= 30) return "importance-30";
  return "importance-10";
}
