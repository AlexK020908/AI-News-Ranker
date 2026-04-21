import Link from "next/link";
import { TrendingUp, ArrowRight } from "lucide-react";
import type { TopicSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TopicsStrip({ topics }: { topics: TopicSummary[] }) {
  if (topics.length === 0) return null;
  return (
    <section className="mb-5" aria-labelledby="topics-heading">
      <div className="mb-2 flex items-baseline gap-2">
        <h2
          id="topics-heading"
          className="inline-flex items-center gap-1.5 label-caps text-accent"
        >
          <TrendingUp className="h-3.5 w-3.5" /> Topics
        </h2>
        <span className="text-[11px] text-muted-fg">
          clusters with momentum right now
        </span>
      </div>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1.5 scrollbar-thin">
        {topics.map((t) => (
          <TopicCard key={t.id} topic={t} />
        ))}
      </div>
    </section>
  );
}

function TopicCard({ topic }: { topic: TopicSummary }) {
  const heat = heatTier(topic.max_importance ?? topic.avg_importance ?? 0);
  return (
    <Link
      href={`/topic/${topic.slug}`}
      className={cn(
        "group relative flex min-w-[220px] max-w-[280px] shrink-0 flex-col gap-1.5 rounded-lg border bg-card/60 px-3 py-2.5 transition-all",
        "border-border hover:border-border-strong hover:bg-card-raised",
        heat.glow,
      )}
    >
      <span className={cn("absolute left-0 top-0 bottom-0 w-[2px] rounded-l-lg", heat.bar)} aria-hidden />
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight text-fg transition-colors group-hover:text-primary line-clamp-1">
          {topic.label}
        </h3>
        <span
          className="shrink-0 rounded-md border border-border bg-bg/40 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-fg"
          title={`${topic.member_count} items`}
        >
          {topic.member_count}
        </span>
      </div>
      {topic.summary && (
        <p className="text-[11px] leading-snug text-muted-fg line-clamp-2">
          {topic.summary}
        </p>
      )}
      <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-fg">
        <span className="font-mono tabular-nums">
          avg {Math.round(topic.avg_importance ?? 0)}
          {topic.max_importance !== null && (
            <> · peak {topic.max_importance}</>
          )}
        </span>
        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

interface HeatTier {
  min: number;
  bar: string;
  glow: string;
}

// Ordered descending by `min`; last entry has min: 0 so .find always matches.
const HEAT: HeatTier[] = [
  { min: 90, bar: "bg-rose-500/80",    glow: "hover:shadow-[0_0_0_1px_rgba(244,63,94,0.2),0_8px_24px_-12px_rgba(244,63,94,0.35)]" },
  { min: 75, bar: "bg-amber-500/70",   glow: "hover:shadow-[0_0_0_1px_rgba(251,146,60,0.18),0_8px_24px_-12px_rgba(251,146,60,0.3)]" },
  { min: 60, bar: "bg-yellow-500/70",  glow: "" },
  { min: 0,  bar: "bg-muted-fg/40",    glow: "" },
];

function heatTier(n: number): HeatTier {
  return HEAT.find((h) => n >= h.min) ?? HEAT[HEAT.length - 1];
}
