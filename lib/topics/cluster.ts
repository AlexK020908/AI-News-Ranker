// Single-link clustering over an embedding graph.
// For each pair of items with cosine similarity >= threshold, union them in a
// disjoint-set forest. Groups of size >= min_size become topics.
//
// Single-link (vs centroid-link or HDBSCAN) is a deliberate choice: the dedup
// step already collapsed exact duplicates, so the items that remain in a 48h
// window are genuinely distinct but topically related. Transitive connection
// works well here — Paper A links to B links to C, all three belong together
// even if A and C aren't directly similar.

export interface ClusterInput {
  id: string;
  embedding: number[];
  importance: number | null;
}

export interface Cluster {
  member_ids: string[];
  centroid: number[];
  member_count: number;
  avg_importance: number;
  max_importance: number;
  // Avg cosine similarity of each member to the centroid — a tightness metric.
  avg_similarity: number;
}

export interface ClusterOptions {
  threshold?: number; // cosine similarity to draw an edge (default 0.78)
  min_size?: number;  // minimum cluster size to emit (default 3)
  max_size?: number;  // truncate over-broad clusters (safety rail, default 40)
}

const DEFAULTS = { threshold: 0.78, min_size: 3, max_size: 40 } as const;

export function clusterByEmbedding(
  items: readonly ClusterInput[],
  opts: ClusterOptions = {},
): Cluster[] {
  const { threshold, min_size, max_size } = { ...DEFAULTS, ...opts };
  const n = items.length;
  if (n < min_size) return [];

  const norms = items.map((it) => norm(it.embedding));
  const parent = Array.from({ length: n }, (_, i) => i);

  function find(x: number): number {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    let c = x;
    while (parent[c] !== r) {
      const next = parent[c];
      parent[c] = r;
      c = next;
    }
    return r;
  }
  function union(a: number, b: number) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Pairwise is O(n^2). For the 48h window (typically <2000 items), fine.
  for (let i = 0; i < n; i++) {
    const ei = items[i].embedding;
    const ni = norms[i];
    if (ni === 0) continue;
    for (let j = i + 1; j < n; j++) {
      const nj = norms[j];
      if (nj === 0) continue;
      const sim = dot(ei, items[j].embedding) / (ni * nj);
      if (sim >= threshold) union(i, j);
    }
  }

  // Group indices by root.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }

  const clusters: Cluster[] = [];
  for (const indices of groups.values()) {
    if (indices.length < min_size) continue;

    // If a group is oversized, keep only the highest-importance members.
    let kept = indices;
    if (indices.length > max_size) {
      kept = [...indices]
        .sort((a, b) => (items[b].importance ?? 0) - (items[a].importance ?? 0))
        .slice(0, max_size);
    }

    const dim = items[kept[0]].embedding.length;
    const centroid = new Array<number>(dim).fill(0);
    let impSum = 0;
    let impMax = 0;
    for (const idx of kept) {
      const emb = items[idx].embedding;
      for (let d = 0; d < dim; d++) centroid[d] += emb[d];
      const imp = items[idx].importance ?? 0;
      impSum += imp;
      if (imp > impMax) impMax = imp;
    }
    const m = kept.length;
    for (let d = 0; d < dim; d++) centroid[d] /= m;

    // Measure tightness: mean cosine sim from each member to the centroid.
    const cn = norm(centroid);
    let simSum = 0;
    if (cn > 0) {
      for (const idx of kept) {
        const emb = items[idx].embedding;
        const en = norms[idx];
        if (en === 0) continue;
        simSum += dot(emb, centroid) / (en * cn);
      }
    }

    clusters.push({
      member_ids: kept.map((idx) => items[idx].id),
      centroid,
      member_count: m,
      avg_importance: impSum / m,
      max_importance: impMax,
      avg_similarity: cn > 0 ? simSum / m : 0,
    });
  }

  // Biggest & most important clusters first.
  clusters.sort(
    (a, b) =>
      b.member_count * b.avg_importance - a.member_count * a.avg_importance,
  );
  return clusters;
}

function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function norm(a: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s);
}

export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

// Cheaper variant when one side's norm is already known — lets hot loops over
// many candidates avoid recomputing the same vector's norm each iteration.
export function cosineSimilarityWithNorm(
  a: readonly number[],
  aNorm: number,
  b: readonly number[],
  bNorm: number,
): number {
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot(a, b) / (aNorm * bNorm);
}

export function vectorNorm(a: readonly number[]): number {
  return norm(a);
}

export function memberHash(memberIds: readonly string[]): string {
  // Stable signature so the cron can detect unchanged clusters and skip
  // re-labeling. Not cryptographic — identity-only.
  return [...memberIds].sort().join("|");
}
