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
  // Deterministic edges to force-union regardless of cosine similarity. Each
  // pair is two item ids known to belong together from a hard identifier (e.g.
  // a paper and the GitHub repo that implements it, or the same arXiv ID
  // ingested from two sources). Pairs referencing ids not present in `items`
  // are ignored. See lib/topics/links.ts.
  mustLink?: ReadonlyArray<readonly [string, string]>;
  // Split incoherent (chained) clusters. Single-link clustering can fuse two
  // distinct stories through a bridge item (a roundup that covers both), so a
  // group is re-clustered at a tighter threshold; if that reveals two genuinely
  // distinct sub-stories the merge is broken apart. OFF by default — the loose
  // paper-thematic pass WANTS broad rollups, so only the tight all-category pass
  // enables this. (Default false.)
  split_incoherent?: boolean;
}

const DEFAULTS = { threshold: 0.78, min_size: 3, max_size: 40 } as const;

// Split-tuning. A group is bisected (cosine 2-means) and the cut is ACCEPTED
// only when both halves are >= min_size AND their centroids are mutually
// dissimilar (cosine < the base threshold) — i.e. the two lobes wouldn't
// themselves cluster. Separation (not intra-cluster tightness) is the reliable
// signal: two stories sharing an entity ("Anthropic ships X" vs "Anthropic
// raises Y") still sit fairly close to a shared centroid, so a tightness floor
// would miss them, but 2-means finds the two lobes even when a roundup "bridge"
// item (similar to both) is what single-link chained them together.
const KMEANS_ITERS = 8;    // Lloyd iterations for the bisection (converges fast)
const MAX_SPLIT_DEPTH = 3; // bound recursion for 3+-story chains

export function clusterByEmbedding(
  items: readonly ClusterInput[],
  opts: ClusterOptions = {},
): Cluster[] {
  const { threshold, min_size, max_size } = { ...DEFAULTS, ...opts };
  const n = items.length;
  if (n < min_size) return [];

  // Ids touched by a deterministic mustLink edge. A group containing any of
  // these is NOT bisected: mustLink deliberately unions dissimilar items
  // (paper↔repo), exactly the shape 2-means would tear apart, so we leave those
  // groups whole. The chaining problem this guards against is a news-roundup
  // problem, and news items carry no mustLink edges.
  const linkedIds = new Set<string>();
  if (opts.mustLink) for (const [a, b] of opts.mustLink) { linkedIds.add(a); linkedIds.add(b); }

  const clusters: Cluster[] = [];
  for (const group of singleLinkGroups(items, threshold, opts.mustLink)) {
    if (group.length < min_size) continue;
    const splittable =
      opts.split_incoherent && !group.some((it) => linkedIds.has(it.id));
    if (splittable) {
      clusters.push(...emitCoherent(group, threshold, min_size, max_size, 0));
    } else {
      clusters.push(buildCluster(group, max_size));
    }
  }

  // Biggest & most important clusters first.
  clusters.sort(
    (a, b) =>
      b.member_count * b.avg_importance - a.member_count * a.avg_importance,
  );
  return clusters;
}

// Single-link (disjoint-set) grouping over an embedding graph: draw an edge for
// every pair with cosine >= threshold (plus the deterministic mustLink edges),
// then return the connected components as arrays of the input items.
function singleLinkGroups(
  items: readonly ClusterInput[],
  threshold: number,
  mustLink: ReadonlyArray<readonly [string, string]> | undefined,
): ClusterInput[][] {
  const n = items.length;
  if (n === 0) return [];
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

  // Seed deterministic edges first. A paper and its implementing repo (or the
  // same arXiv ID from two sources) often DON'T clear the cosine threshold —
  // an abstract and a README read differently — so we union them outright
  // before the similarity pass. Items with a zero norm (no usable embedding)
  // are still linked: the edge is identity-based, not geometric.
  if (mustLink && mustLink.length > 0) {
    const indexById = new Map<string, number>();
    for (let i = 0; i < n; i++) indexById.set(items[i].id, i);
    for (const [a, b] of mustLink) {
      const ia = indexById.get(a);
      const ib = indexById.get(b);
      if (ia !== undefined && ib !== undefined && ia !== ib) union(ia, ib);
    }
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

  const groups = new Map<number, ClusterInput[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(items[i]);
    else groups.set(r, [items[i]]);
  }
  return [...groups.values()];
}

// Build a Cluster from a member set: importance-truncate over-broad groups,
// compute the centroid, and measure tightness (mean member→centroid cosine).
function buildCluster(members: readonly ClusterInput[], max_size: number): Cluster {
  let kept = members;
  if (members.length > max_size) {
    kept = [...members]
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
      .slice(0, max_size);
  }

  const dim = kept[0].embedding.length;
  const centroid = new Array<number>(dim).fill(0);
  let impSum = 0;
  let impMax = 0;
  for (const it of kept) {
    const emb = it.embedding;
    for (let d = 0; d < dim; d++) centroid[d] += emb[d];
    const imp = it.importance ?? 0;
    impSum += imp;
    if (imp > impMax) impMax = imp;
  }
  const m = kept.length;
  for (let d = 0; d < dim; d++) centroid[d] /= m;

  const cn = norm(centroid);
  let simSum = 0;
  if (cn > 0) {
    for (const it of kept) {
      const en = norm(it.embedding);
      if (en === 0) continue;
      simSum += dot(it.embedding, centroid) / (en * cn);
    }
  }

  return {
    member_ids: kept.map((it) => it.id),
    centroid,
    member_count: m,
    avg_importance: impSum / m,
    max_importance: impMax,
    avg_similarity: cn > 0 ? simSum / m : 0,
  };
}

// Emit a member set as one or more COHERENT clusters. The group is bisected; if
// it cleanly separates into two distinct sub-stories the merge is broken apart
// (recursively, in case a sub-story is itself a chain of 3+), otherwise it's
// emitted whole.
function emitCoherent(
  members: ClusterInput[],
  threshold: number,
  min_size: number,
  max_size: number,
  depth: number,
): Cluster[] {
  if (members.length < min_size) return [];
  const whole = buildCluster(members, max_size);

  // Too small to yield two valid clusters, or out of split budget → emit whole.
  if (members.length < 2 * min_size || depth >= MAX_SPLIT_DEPTH) return [whole];

  const halves = bisect(members, threshold, min_size);
  if (!halves) return [whole];

  const out: Cluster[] = [];
  for (const h of halves) {
    out.push(...emitCoherent(h, threshold, min_size, max_size, depth + 1));
  }
  // If recursion somehow dropped everything below min_size, don't vanish a real
  // story — fall back to the original cluster.
  return out.length > 0 ? out : [whole];
}

// Cosine 2-means bisection. Returns two well-separated halves (each >= min_size)
// or null when the members are a single coherent story. Seeds with the two
// least-similar members (farthest-point init): if even the most extreme pair
// would still cluster at the base threshold, there's no bimodal cut to make.
function bisect(
  members: ClusterInput[],
  threshold: number,
  min_size: number,
): [ClusterInput[], ClusterInput[]] | null {
  const n = members.length;
  const norms = members.map((m) => norm(m.embedding));

  let si = -1, sj = -1, minSim = Infinity;
  for (let i = 0; i < n; i++) {
    if (norms[i] === 0) continue;
    for (let j = i + 1; j < n; j++) {
      if (norms[j] === 0) continue;
      const sim = dot(members[i].embedding, members[j].embedding) / (norms[i] * norms[j]);
      if (sim < minSim) { minSim = sim; si = i; sj = j; }
    }
  }
  // No usable extremes, or the whole group is tight enough to be one story.
  if (si < 0 || minSim >= threshold) return null;

  let cA = members[si].embedding.slice();
  let cB = members[sj].embedding.slice();
  const assign = new Array<number>(n).fill(0);
  const dim = members[0].embedding.length;

  for (let iter = 0; iter < KMEANS_ITERS; iter++) {
    const nA = norm(cA), nB = norm(cB);
    let changed = false;
    for (let i = 0; i < n; i++) {
      // Zero-norm items have no direction; park them in A deterministically.
      const a =
        norms[i] === 0
          ? 0
          : (nA > 0 ? dot(members[i].embedding, cA) / (norms[i] * nA) : -1) >=
            (nB > 0 ? dot(members[i].embedding, cB) / (norms[i] * nB) : -1)
            ? 0
            : 1;
      if (a !== assign[i]) { assign[i] = a; changed = true; }
    }
    const sumA = new Array<number>(dim).fill(0);
    const sumB = new Array<number>(dim).fill(0);
    let cntA = 0, cntB = 0;
    for (let i = 0; i < n; i++) {
      const e = members[i].embedding;
      if (assign[i] === 0) { for (let d = 0; d < dim; d++) sumA[d] += e[d]; cntA++; }
      else { for (let d = 0; d < dim; d++) sumB[d] += e[d]; cntB++; }
    }
    if (cntA === 0 || cntB === 0) return null; // collapsed to one side
    for (let d = 0; d < dim; d++) { sumA[d] /= cntA; sumB[d] /= cntB; }
    cA = sumA; cB = sumB;
    if (!changed) break;
  }

  const A: ClusterInput[] = [];
  const B: ClusterInput[] = [];
  for (let i = 0; i < n; i++) (assign[i] === 0 ? A : B).push(members[i]);
  if (A.length < min_size || B.length < min_size) return null;
  // Final guard: only split when the two lobes are genuinely distinct stories.
  if (cosineSimilarity(cA, cB) >= threshold) return null;
  return [A, B];
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
  // Stable signature so the job can detect unchanged clusters and skip
  // re-labeling. Not cryptographic — identity-only.
  return [...memberIds].sort().join("|");
}
