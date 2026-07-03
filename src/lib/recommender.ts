// Engine 2 — Kernel-regression recommender over fingerprint axes (type-aware).

export const RAX = [
  "fresh",
  "acid",
  "tannin",
  "fruit_dark",
  "ripe",
  "oak",
  "body",
  "savory",
] as const;
export type FpKey = (typeof RAX)[number];

export type WineType = "red" | "white" | "sparkling" | "rose" | "dessert";

export type BottleFp = {
  id: string;
  name: string;
  producer?: string | null;
  region?: string | null;
  type: WineType;
  fp: Record<FpKey, number>;
};

export type RatedFp = BottleFp & { stars: number };

export type Recommendation = {
  bottle: BottleFp;
  predicted: number;
  nearest: RatedFp | null;
  maxSimilarity: number;
  confidence: number;
};

/**
 * A white/sparkling/rosé bottle has NO tannin and NO fruit_dark signal — those
 * axes are absent, not zero-valued votes. Shared axes apply to every type.
 */
export function axisApplies(axis: FpKey, type: WineType): boolean {
  if (axis === "tannin" || axis === "fruit_dark") return type === "red" || type === "dessert";
  return true;
}

function corr(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/** Learn per-axis importance weights from rated wines (correlation vs stars).
 *  Falls back to UNIFORM weights across applicable axes when no axis has
 *  ≥2 datapoints — so a single rated wine of a type still yields a signal. */
function learnWeights(
  rated: RatedFp[],
  fallbackType: WineType,
): { W: Record<FpKey, number>; active: FpKey[] } {
  const importance: Record<FpKey, number> = {} as Record<FpKey, number>;
  for (const k of RAX) {
    const pool = rated.filter((r) => axisApplies(k, r.type));
    if (pool.length < 2) {
      importance[k] = 0;
    } else {
      const xs = pool.map((r) => r.fp[k]);
      const ys = pool.map((r) => r.stars);
      importance[k] = Math.max(Math.abs(corr(xs, ys)), 0.05);
    }
  }
  let active = RAX.filter((k) => importance[k] > 0);
  const W: Record<FpKey, number> = {} as Record<FpKey, number>;

  if (active.length === 0) {
    // Cold-type fallback: uniform across axes applicable to the candidate's type.
    const applicable = RAX.filter((k) => axisApplies(k, fallbackType));
    const w = applicable.length > 0 ? 1 / applicable.length : 0;
    for (const k of RAX) W[k] = applicable.includes(k) ? w : 0;
    active = applicable;
  } else {
    const totalImp = active.reduce((s, k) => s + importance[k], 0);
    for (const k of RAX) W[k] = totalImp > 0 && active.includes(k) ? importance[k] / totalImp : 0;
  }
  return { W, active };
}

/** Kernel-regression score of one candidate against a set of same-type rated wines. */
function scoreCandidate(
  candidate: BottleFp,
  sameType: RatedFp[],
  W: Record<FpKey, number>,
  active: FpKey[],
  bandwidth: number,
  alpha: number,
  prior: number,
): { predicted: number; nearest: RatedFp | null; maxSimilarity: number; confidence: number } | null {
  if (sameType.length === 0) return null;
  const twoBwSq = 2 * bandwidth * bandwidth;
  const used = active.filter((k) => axisApplies(k, candidate.type));
  let num = 0, den = 0, best = -1, bestAny = -1;
  let nearest: RatedFp | null = null;
  let nearestAny: RatedFp | null = null;
  for (const r of sameType) {
    if (used.length === 0) continue;
    let wsum = 0;
    let d2 = 0;
    for (const k of used) {
      const w = W[k];
      wsum += w;
      const diff = candidate.fp[k] - r.fp[k];
      d2 += w * diff * diff;
    }
    if (wsum === 0) continue;
    d2 = d2 / wsum;
    const sim = Math.exp(-d2 / twoBwSq);
    num += sim * r.stars;
    den += sim;
    if (sim > bestAny) { bestAny = sim; nearestAny = r; }
    if (sim > best && r.stars >= 4) { best = sim; nearest = r; }
  }
  if (!nearest) nearest = nearestAny;
  const predicted = (num + alpha * prior) / (den + alpha);
  const confidence = den / (den + alpha);
  return { predicted, nearest, maxSimilarity: Math.max(bestAny, 0), confidence };
}

const BW_GRID = [0.03, 0.05, 0.08, 0.12, 0.18] as const;
const SMALL_SAMPLE_MIN_BW = 0.08;
const SMALL_SAMPLE_THRESHOLD = 8;

/** Leave-one-out CV over a small bandwidth grid. Picks the bandwidth with
 *  lowest squared prediction error on held-out rated wines. Needs ≥5 rated.
 *  Small-sample floor: fewer than 8 rated wines never selects below 0.08
 *  (tight kernels overfit tiny samples). */
export function selectBandwidth(rated: RatedFp[]): number {
  if (rated.length < 5) return 0.12;
  const alpha = 0.4;
  const prior = 3.0;
  const grid = rated.length < SMALL_SAMPLE_THRESHOLD
    ? BW_GRID.filter((bw) => bw >= SMALL_SAMPLE_MIN_BW)
    : (BW_GRID as unknown as number[]);
  let bestBw = 0.12;
  let bestErr = Infinity;
  for (const bw of grid) {
    let err = 0;
    for (let i = 0; i < rated.length; i++) {
      const heldOut = rated[i];
      const rest = rated.slice(0, i).concat(rated.slice(i + 1));
      const sameType = rest.filter((r) => r.type === heldOut.type);
      if (sameType.length === 0) continue;
      const { W, active } = learnWeights(rest, heldOut.type);
      const scored = scoreCandidate(heldOut, sameType, W, active, bw, alpha, prior);
      if (!scored) continue;
      const d = scored.predicted - heldOut.stars;
      err += d * d;
    }
    if (err < bestErr) { bestErr = err; bestBw = bw; }
  }
  return bestBw;
}

export function recommend(
  rated: RatedFp[],
  unrated: BottleFp[],
  opts: { bandwidth?: number; shrinkAlpha?: number; shrinkPrior?: number; restrictToRatedTypes?: boolean } = {},
): Recommendation[] {
  if (rated.length === 0) return [];
  const bw = opts.bandwidth ?? selectBandwidth(rated);
  const alpha = opts.shrinkAlpha ?? 0.4;
  const prior = opts.shrinkPrior ?? 3.0;
  const restrict = opts.restrictToRatedTypes ?? true;

  const ratedTypes = new Set(rated.map((r) => r.type));
  const candidates = restrict ? unrated.filter((b) => ratedTypes.has(b.type)) : unrated;

  const results: Recommendation[] = candidates
    .map((b) => {
      const sameType = rated.filter((r) => r.type === b.type);
      if (sameType.length === 0) return null;
      const { W, active } = learnWeights(sameType, b.type);
      const scored = scoreCandidate(b, sameType, W, active, bw, alpha, prior);
      if (!scored) return null;
      return { bottle: b, ...scored };
    })
    .filter((r): r is Recommendation => r !== null);

  return results.sort((a, b) => b.predicted - a.predicted);
}
