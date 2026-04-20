"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { ItemCard } from "@/components/item-card";
import { EmptyState } from "@/components/empty-state";
import type { Category, Item, ItemWithSource, SourceKind } from "@/lib/types";

export type SourceInfo = { slug: string; name: string; kind: SourceKind };
export type SourceMap = Record<string, SourceInfo>;

interface Props {
  initialItems: ItemWithSource[];
  sources: SourceMap;
  filter: { sort: "hot" | "new"; cat: Category | null; min: number };
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

  const { sort, cat, min } = filter;

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

    function applyChange(row: Item) {
      if (!matchesFilter(row, { sort, cat, min })) return;
      const source = sources[row.source_id];
      if (!source) return;
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
  }, [sort, cat, min, sources]);

  const rendered = useMemo(() => items, [items]);
  if (rendered.length === 0) return <EmptyState />;

  return (
    <div className="grid gap-3">
      {rendered.map((item) => (
        <ItemCard key={item.id} item={item} isNew={justArrived.has(item.id)} />
      ))}
    </div>
  );
}

function matchesFilter(
  item: Item,
  filter: { sort: "hot" | "new"; cat: Category | null; min: number },
) {
  if (item.enriched_at == null) return false;
  if (item.duplicate_of != null) return false;
  if (filter.cat && item.category !== filter.cat) return false;
  if (filter.min > 0 && (item.importance ?? 0) < filter.min) return false;
  return true;
}

function sortComparator(sort: "hot" | "new") {
  return (a: ItemWithSource, b: ItemWithSource) => {
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
