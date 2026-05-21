import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/types";
import type { StackTopic } from "./types";

// The Stack design has a horizontally-scrollable pill rail of topics in the
// nav. Backed by the Category enum since that's what every item is tagged
// with at enrich-time; "all" is the leftmost catch-all that disables the
// filter. Keep ordering deterministic so the rail doesn't reshuffle on
// re-renders.
export const STACK_TOPICS: StackTopic[] = [
  { id: "all", label: "All" },
  ...CATEGORIES.map<StackTopic>((c) => ({ id: c, label: CATEGORY_LABELS[c] })),
];

export function isStackTopicId(x: unknown): x is string {
  if (typeof x !== "string") return false;
  if (x === "all") return true;
  return (CATEGORIES as readonly string[]).includes(x);
}

export function topicForCluster(memberCategories: (Category | null | undefined)[]): string {
  // A cluster's topic = the most common category among its members.
  // Ties resolve by CATEGORIES declaration order, which biases toward the
  // earlier / more specific categories (paper > model > release > …).
  const counts = new Map<Category, number>();
  for (const c of memberCategories) {
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (counts.size === 0) return "news";
  let best: Category = "news";
  let bestN = -1;
  for (const c of CATEGORIES) {
    const n = counts.get(c) ?? 0;
    if (n > bestN) { best = c; bestN = n; }
  }
  return best;
}
