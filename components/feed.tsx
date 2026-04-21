"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import {
  kindsFor,
  type Category,
  type Item,
  type ItemWithSource,
  type SortMode,
  type SourceGroup,
  type SourceKind,
} from "@/lib/types";

export type SourceInfo = { slug: string; name: string; kind: SourceKind };
export type SourceMap = Record<string, SourceInfo>;

interface Props {
  initialItems: ItemWithSource[];
  sources: SourceMap;
  filter: {
    sort: SortMode;
    cat: Category | null;
    min: number;
    src: SourceGroup | null;
  };
}

const MAX_ITEMS = 60;
const NEW_BADGE_MS = 8_000;

export function Feed({ initialItems, sources, filter }: Props) {
  const [items, setItems] = useState<ItemWithSource[]>(initialItems);
  const [justArrived, setJustArrived] = useState<Set<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const { sort, cat, min, src } = filter;

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("items-feed")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "items" },
        (payload) => applyChange(payload.new as Item),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "items" },
        (payload) => applyChange(payload.new as Item),
      )
      .subscribe();

    const allowedKinds = kindsFor(src);
    const allowedKindSet = allowedKinds ? new Set(allowedKinds) : null;

    function applyChange(row: Item) {
      if (!matchesFilter(row, cat, min)) return;
      const source = sources[row.source_id];
      if (!source || (allowedKindSet && !allowedKindSet.has(source.kind))) return;
      const full: ItemWithSource = { ...row, source };

      setItems((prev) => {
        const without = prev.filter((i) => i.id !== row.id);
        const next = [full, ...without];
        next.sort(sortComparator(sort));
        return next.slice(0, MAX_ITEMS);
      });

      setJustArrived((prev) => {
        if (prev.has(row.id)) return prev;
        const copy = new Set(prev);
        copy.add(row.id);
        return copy;
      });

      const existing = timers.current.get(row.id);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        setJustArrived((prev) => {
          if (!prev.has(row.id)) return prev;
          const copy = new Set(prev);
          copy.delete(row.id);
          return copy;
        });
        timers.current.delete(row.id);
      }, NEW_BADGE_MS);
      timers.current.set(row.id, t);
    }

    return () => {
      supabase.removeChannel(channel);
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
  }, [sort, cat, min, src, sources]);

  if (items.length === 0) return <EmptyState />;

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} isNew={justArrived.has(item.id)} />
      ))}
    </div>
  );
}

function matchesFilter(item: Item, cat: Category | null, min: number) {
  if (item.enriched_at == null) return false;
  if (item.duplicate_of != null) return false;
  if (cat && item.category !== cat) return false;
  if (min > 0 && (item.importance ?? 0) < min) return false;
  return true;
}

// Realtime inserts bypass the trending_items() RPC, so we re-score client-side
// to place them. Formula must stay in sync with the SQL in 001_schema.sql.
const TRENDING_DUP_WEIGHT = 10;
const TRENDING_TOPIC_WEIGHT = 3;
const TRENDING_ENGAGEMENT_WEIGHT = 0.3;
const TRENDING_DECAY = 1.5;

function paperBonus(influential: number | null): number {
  if (!influential || influential <= 0) return 0;
  return 20 + Math.min(influential * 5, 40);
}

function trendingScore(item: ItemWithSource): number {
  const baseTime = new Date(item.published_at ?? item.ingested_at).getTime();
  const hours = Math.max(0, (Date.now() - baseTime) / 3_600_000);
  const numerator =
    (item.importance ?? 0) +
    (item.engagement_score ?? 0) * TRENDING_ENGAGEMENT_WEIGHT +
    (item.source_weight_sum ?? 1) * TRENDING_DUP_WEIGHT +
    (item.topic_size ?? 0) * TRENDING_TOPIC_WEIGHT +
    paperBonus(item.paper_influential_citations);
  return numerator / Math.pow(hours + 2, TRENDING_DECAY);
}

function sortComparator(sort: SortMode) {
  return (a: ItemWithSource, b: ItemWithSource) => {
    if (sort === "trending") {
      return trendingScore(b) - trendingScore(a);
    }
    const aDate = new Date(a.published_at ?? a.ingested_at).getTime();
    const bDate = new Date(b.published_at ?? b.ingested_at).getTime();
    if (sort === "hot") {
      const aI = a.importance ?? 0;
      const bI = b.importance ?? 0;
      if (bI !== aI) return bI - aI;
    }
    return bDate - aDate;
  };
}
