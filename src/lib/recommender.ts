// Engine 2 — Kernel-regression recommender over fingerprint axes.

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

export type BottleFp = {
  id: string;
  name: string;
  producer?: string | null;
  region?: string | null;
  fp: Record<FpKey, number>;
};

export type RatedFp = BottleFp & { stars: number };

export type Recommendation = {
  bottle: BottleFp;
  predicted: number;
  nearest: RatedFp | null;
  maxSimilarity: number;
};

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
  opts: { bandwidth?: number } = {},
): Recommendation[] {
  if (rated.length === 0) return [];
  const bw = opts.bandwidth ?? 0.2;

  // Learn axis importance from |corr(fp[k], stars)|.
  const starList = rated.map((r) => r.stars);
  const importance: Record<FpKey, number> = {} as Record<FpKey, number>;
  for (const k of RAX) {
    const xs = rated.map((r) => r.fp[k]);
    importance[k] = Math.max(Math.abs(corr(xs, starList)), 0.05);
  }
  const totalImp = RAX.reduce((s, k) => s + importance[k], 0);
  const W: Record<FpKey, number> = {} as Record<FpKey, number>;
  for (const k of RAX) W[k] = importance[k] / totalImp;

  const twoBwSq = 2 * bw * bw;

  const results: Recommendation[] = unrated.map((b) => {
    let num = 0, den = 0, best = -1, bestAny = -1;
    let nearest: RatedFp | null = null;
    let nearestAny: RatedFp | null = null;
    for (const r of rated) {
      let d2 = 0;
      for (const k of RAX) {
        const diff = b.fp[k] - r.fp[k];
        d2 += W[k] * diff * diff;
      }
      const sim = Math.exp(-d2 / twoBwSq);
      num += sim * r.stars;
      den += sim;
      if (sim > bestAny) { bestAny = sim; nearestAny = r; }
      if (sim > best && r.stars >= 4) { best = sim; nearest = r; }
    }
    if (!nearest) nearest = nearestAny;
    const predicted = den === 0 ? 3 : num / den;
    return { bottle: b, predicted, nearest, maxSimilarity: bestAny };
  });

  return results.sort((a, b) => b.predicted - a.predicted);
}
