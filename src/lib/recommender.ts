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

export type RatedFp = BottleFp & {
  stars: number;
  /** Sample weight in the kernel regression (default 1.0). Canon wines pass CANON_WEIGHT. */
  weight?: number;
  /** True if this rated wine is a Canon anchor for its region. */
  canon?: boolean;
};

export type Recommendation = {
  bottle: BottleFp;
  predicted: number;
  nearest: RatedFp | null;
  nearestIsCanon: boolean;
  maxSimilarity: number;
  confidence: number;
};

/** Fixed sample-weight multiplier applied to Canon anchors in the kernel regression. */
export const CANON_WEIGHT = 3.0;


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
  // Evidence-scaled shrinkage: a candidate surrounded by many similar rated
  // wines barely feels the prior, while a lonely candidate is still pulled to it.
  const alphaEff = alpha / (1 + den);
  const predicted = (num + alphaEff * prior) / (den + alphaEff);
  const confidence = den / (den + alphaEff);
  return { predicted, nearest, maxSimilarity: Math.max(bestAny, 0), confidence };
}




const BW_GRID = [0.08, 0.12, 0.18, 0.25] as const;
const ALPHA_GRID = [0.2, 0.4, 0.8] as const;
const SMALL_SAMPLE_THRESHOLD = 8;
const DEFAULT_BW = 0.12;
const DEFAULT_ALPHA = 0.4;
const GLOBAL_PRIOR = 3.0;

export type KernelParams = { bandwidth: number; alpha: number };

/** Personalized per-type prior with 3-pseudocount shrinkage toward 3.0. */
export function computeTypePriors(rated: RatedFp[]): Record<WineType, number> {
  const types: WineType[] = ["red", "white", "sparkling", "rose", "dessert"];
  const out = {} as Record<WineType, number>;
  for (const t of types) {
    const pool = rated.filter((r) => r.type === t);
    if (pool.length === 0) { out[t] = GLOBAL_PRIOR; continue; }
    const sum = pool.reduce((s, r) => s + r.stars, 0);
    out[t] = (sum + 3 * GLOBAL_PRIOR) / (pool.length + 3);
  }
  return out;
}

/** Backwards-compatible bandwidth-only selector (delegates to joint LOO). */
export function selectBandwidth(rated: RatedFp[]): number {
  return selectKernelParams(rated).bandwidth;
}

export type LooCell = { bandwidth: number; alpha: number; error: number };

/** Compute the weighted-LOO error grid used by selectKernelParams. Exported
 *  for diagnostics. Each held-out wine's squared error is weighted by
 *  |stars - typePrior| + 0.5, so extreme (loved/disliked) wines dominate. */
export function looErrorTable(rated: RatedFp[]): LooCell[] {
  const priors = computeTypePriors(rated);
  const cells: LooCell[] = [];
  for (const bw of BW_GRID) {
    for (const alpha of ALPHA_GRID) {
      let err = 0;
      for (let i = 0; i < rated.length; i++) {
        const heldOut = rated[i];
        const rest = rated.slice(0, i).concat(rated.slice(i + 1));
        const sameType = rest.filter((r) => r.type === heldOut.type);
        if (sameType.length === 0) continue;
        const { W, active } = learnWeights(rest, heldOut.type);
        const scored = scoreCandidate(heldOut, sameType, W, active, bw, alpha, priors[heldOut.type]);
        if (!scored) continue;
        const d = scored.predicted - heldOut.stars;
        const w = Math.abs(heldOut.stars - priors[heldOut.type]) + 0.5;
        err += w * d * d;
      }
      cells.push({ bandwidth: bw, alpha, error: err });
    }
  }
  return cells;
}

/** Joint leave-one-out CV over (bandwidth, alpha), using personalized per-type
 *  priors and an extremes-weighted squared-error objective so a timid kernel
 *  (huge alpha, tiny bandwidth) can't win by predicting the prior. */
export function selectKernelParams(rated: RatedFp[]): KernelParams {
  if (rated.length < SMALL_SAMPLE_THRESHOLD) {
    return { bandwidth: DEFAULT_BW, alpha: DEFAULT_ALPHA };
  }
  const table = looErrorTable(rated);
  let best: KernelParams = { bandwidth: DEFAULT_BW, alpha: DEFAULT_ALPHA };
  let bestErr = Infinity;
  for (const c of table) {
    if (c.error < bestErr) { bestErr = c.error; best = { bandwidth: c.bandwidth, alpha: c.alpha }; }
  }
  return best;
}

export function recommend(
  rated: RatedFp[],
  unrated: BottleFp[],
  opts: { bandwidth?: number; shrinkAlpha?: number; shrinkPrior?: number; restrictToRatedTypes?: boolean } = {},
): Recommendation[] {
  if (rated.length === 0) return [];
  const params = (opts.bandwidth === undefined || opts.shrinkAlpha === undefined)
    ? selectKernelParams(rated)
    : { bandwidth: opts.bandwidth, alpha: opts.shrinkAlpha };
  const bw = opts.bandwidth ?? params.bandwidth;
  const alpha = opts.shrinkAlpha ?? params.alpha;
  const typePriors = computeTypePriors(rated);
  const restrict = opts.restrictToRatedTypes ?? true;

  const ratedTypes = new Set(rated.map((r) => r.type));
  const candidates = restrict ? unrated.filter((b) => ratedTypes.has(b.type)) : unrated;

  const results: Recommendation[] = candidates
    .map((b) => {
      const sameType = rated.filter((r) => r.type === b.type);
      if (sameType.length === 0) return null;
      const { W, active } = learnWeights(sameType, b.type);
      const prior = opts.shrinkPrior ?? typePriors[b.type] ?? GLOBAL_PRIOR;
      const scored = scoreCandidate(b, sameType, W, active, bw, alpha, prior);
      if (!scored) return null;
      return { bottle: b, ...scored };
    })
    .filter((r): r is Recommendation => r !== null);

  return results.sort((a, b) => b.predicted - a.predicted);
}

