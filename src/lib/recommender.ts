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
  if (axis === "tannin" || axis === "fruit_dark") return type === "red";
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

export function recommend(
  rated: RatedFp[],
  unrated: BottleFp[],
  opts: { bandwidth?: number; shrinkAlpha?: number; shrinkPrior?: number; restrictToRatedTypes?: boolean } = {},
): Recommendation[] {
  if (rated.length === 0) return [];
  const bw = opts.bandwidth ?? 0.2;
  const alpha = opts.shrinkAlpha ?? 1.5;   // Laplace-style shrinkage toward prior
  const prior = opts.shrinkPrior ?? 3.0;   // neutral baseline when similarity is low
  const restrict = opts.restrictToRatedTypes ?? true;

  // (a) Learn importance per axis using ONLY rated bottles where the axis applies.
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
  const active = RAX.filter((k) => importance[k] > 0);
  const totalImp = active.reduce((s, k) => s + importance[k], 0);
  const W: Record<FpKey, number> = {} as Record<FpKey, number>;
  for (const k of RAX) W[k] = totalImp > 0 && active.includes(k) ? importance[k] / totalImp : 0;

  const twoBwSq = 2 * bw * bw;

  // (b) Type scoping — don't surface candidates of a type the user has never rated.
  // Reds and dessert reds (e.g. Port) are different palate decisions; keep them
  // separate unless the user has rated both.
  const ratedTypes = new Set(rated.map((r) => r.type));
  const candidates = restrict ? unrated.filter((b) => ratedTypes.has(b.type)) : unrated;

  // (c) Score each candidate ONLY against rated wines of the same type.
  // A red rated 5★ tells us nothing about a Chardonnay; cross-type pairings
  // (even on "shared" axes like body/acid) leak noise and mislabel nearest.
  const results: Recommendation[] = candidates
    .map((b) => {
      const sameType = rated.filter((r) => r.type === b.type);
      if (sameType.length === 0) return null;

      let num = 0, den = 0, best = -1, bestAny = -1;
      let nearest: RatedFp | null = null;
      let nearestAny: RatedFp | null = null;
      for (const r of sameType) {
        const used = active.filter((k) => axisApplies(k, b.type));
        if (used.length === 0) continue;
        let wsum = 0;
        let d2 = 0;
        for (const k of used) {
          const w = W[k];
          wsum += w;
          const diff = b.fp[k] - r.fp[k];
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
      return { bottle: b, predicted, nearest, maxSimilarity: Math.max(bestAny, 0) };
    })
    .filter((r): r is Recommendation => r !== null);


  return results.sort((a, b) => b.predicted - a.predicted);
}
