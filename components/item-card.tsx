import Link from "next/link";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowUpRight, Flame } from "lucide-react";
import type { ItemWithSource } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ItemCard({ item, isNew = false }: { item: ItemWithSource; isNew?: boolean }) {
  const published = item.published_at ?? item.ingested_at;
  const rel = published
    ? formatDistanceToNowStrict(new Date(published), { addSuffix: true })
    : null;
  const importance = item.importance ?? 0;
  const imp = importanceTier(importance);

  return (
    <article
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-4 pl-5 transition-all",
        "border-border hover:border-border-strong hover:bg-card-raised",
        imp.glow,
        isNew && "ring-1 ring-accent/40 animate-in-fade",
      )}
    >
      <span className={cn("absolute left-0 top-0 bottom-0 w-[3px]", imp.bar)} aria-hidden />
      {isNew && (
        <span
          className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent ring-1 ring-accent/30"
          aria-label="newly arrived"
        >
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
          </span>
          New
        </span>
      )}

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
        {rel && (
          <>
            <span className="text-muted-fg/40">·</span>
            <span className="font-mono tabular-nums text-[11px]">{rel}</span>
          </>
        )}
        {item.duplicate_count >= 2 && (
          <span
            className="inline-flex items-center gap-1 rounded-md border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-orange-300"
            title={`${1 + item.duplicate_count} sources covered this`}
          >
            <Flame className="h-3 w-3" />
            {1 + item.duplicate_count} sources
          </span>
        )}
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
            imp.badge,
          )}
          title={`Importance ${importance}/100`}
        >
          {importance}
        </span>
      </div>

      <h2 className="text-[15px] sm:text-base font-semibold leading-snug tracking-tight text-fg group-hover:text-primary transition-colors">
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

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-fg">
        {item.tags?.slice(0, 4).map((t) => (
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
          className="relative z-10 ml-auto inline-flex items-center gap-1 label-caps text-muted-fg hover:text-primary transition-colors"
        >
          source <ArrowUpRight className="h-3 w-3" />
        </a>
      </div>
    </article>
  );
}

interface Tier {
  min: number;
  bar: string;
  badge: string;
  glow: string;
}

const MUTED_BADGE = "border-border bg-muted text-muted-fg";

// Tiers are descending by `min` — first match wins in importanceTier().
const TIERS: Tier[] = [
  { min: 95, bar: "importance-95", badge: "border-rose-500/40 bg-rose-500/10 text-rose-300",       glow: "hover:shadow-[0_0_0_1px_rgba(244,63,94,0.25),0_12px_40px_-20px_rgba(244,63,94,0.4)]" },
  { min: 85, bar: "importance-85", badge: "border-amber-500/40 bg-amber-500/10 text-amber-300",    glow: "hover:shadow-[0_0_0_1px_rgba(251,146,60,0.22),0_12px_40px_-20px_rgba(251,146,60,0.35)]" },
  { min: 70, bar: "importance-70", badge: "border-yellow-500/40 bg-yellow-500/10 text-yellow-200", glow: "hover:shadow-[0_0_0_1px_rgba(74,222,128,0.2),0_12px_40px_-20px_rgba(74,222,128,0.3)]" },
  { min: 50, bar: "importance-50", badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", glow: "hover:shadow-[0_0_0_1px_rgba(74,222,128,0.18),0_10px_30px_-16px_rgba(74,222,128,0.25)]" },
  { min: 30, bar: "importance-30", badge: MUTED_BADGE, glow: "" },
  { min: 0,  bar: "importance-10", badge: MUTED_BADGE, glow: "" },
];

export function importanceTier(n: number): Tier {
  return TIERS.find((t) => n >= t.min) ?? TIERS[TIERS.length - 1];
}
