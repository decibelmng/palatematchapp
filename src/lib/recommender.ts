// Engine v2 — "Sharpened Anchor Field"
//
// Nonparametric, per-user, per-type recommender:
//   1) learn axis-importance weights ω from the user's OWN rating contrasts
//      (non-negative ridge regression on pairwise |Δstars| vs Σ ω·Δxᵢ²);
//   2) pick an adaptive bandwidth h from the median ω-weighted pair distance;
//   3) score each candidate as a sharpened Gaussian-kernel weighted mean
//      (kᵢ = wᵢ·simᵢ^γ), which follows the NEAREST style mode instead of
//      averaging across modes;
//   4) shrink gently toward the user's own per-type mean (not a global 3.0),
//      so a lonely 5★ candidate can predict ~4.6, not 3.8;
//   5) return the evidence mass M = Σ kᵢ separately from the star score;
//   6) cap the prediction near plain dislikes (dislike guard).
//
// Canon anchors carry BENCHMARK_WEIGHT (= 3.0) as a per-sample weight in
// both the ridge fit (via pairWeight = wᵢ·wⱼ) and the kernel sum, without
// contaminating the shrinkage target μᵤ. No axis masking beyond the
// type-scoped `axisApplies` rule.

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
  /** Per-sample weight in the kernel regression + ridge fit (default 1). */
  weight?: number;
  /** Marks this rated wine as a Canon anchor (drives explanation copy). */
  canon?: boolean;
  /** Marks this rated wine as a Nemesis anchor (drives veto + explanation). */
  nemesis?: boolean;
};

export type VetoReason = {
  nemesis: RatedFp;
  distance: number;
  /** 1–2 axes contributing most to ω-distance. */
  drivingAxes: FpKey[];
};

export type ContestedReason = {
  /** The nearby Nemesis whose basin was contested by a nearer love. */
  nemesis: RatedFp;
  /** ω-distance from candidate to that Nemesis. */
  nemesisDistance: number;
  /** The love-anchor (stars ≥ 4) that pulled the candidate out of the basin. */
  nearestPositive: RatedFp;
  /** ω-distance from candidate to nearestPositive. */
  positiveDistance: number;
};

export type Recommendation = {
  bottle: BottleFp;
  predicted: number;
  nearest: RatedFp | null;
  nearestIsCanon: boolean;
  maxSimilarity: number;
  /** Legacy 0..1 confidence derived from evidence mass. */
  confidence: number;
  /** Raw evidence mass M = Σ kᵢ. */
  evidence: number;
  /** "strong" | "moderate" | "exploratory" from M. */
  evidenceTier: "strong" | "moderate" | "exploratory";
  /**
   * True when the candidate sits inside a Nemesis's asymmetric reach AND is
   * closer to that Nemesis than to any love (stars ≥ 4). Basin rule.
   */
  vetoed: boolean;
  vetoReason: VetoReason | null;
  /**
   * True when the candidate sits inside a Nemesis's asymmetric reach BUT is
   * closer to a love — the contested zone. No veto, but flag for UI caution.
   */
  contested: boolean;
  contestedReason: ContestedReason | null;
};

// ────────── Config (single tunable object) ──────────
export const SHARPEN_GAMMA = 2.0;
export const PRIOR_ALPHA = 0.5;
export const BENCHMARK_WEIGHT = 3.0;
/** Back-compat alias — old code imports CANON_WEIGHT. */
export const CANON_WEIGHT = BENCHMARK_WEIGHT;
/** Asymmetric veto: repulsion reaches 1.25× the attraction bandwidth. */
export const NEMESIS_RADIUS_MULT = 1.25;
export const H_FLOOR = 0.12;
export const H_CAP = 0.35;
export const H_FALLBACK = 0.20;
export const OMEGA_CLAMP: [number, number] = [0.25, 4.0];
export const EVIDENCE_STRONG = 1.5;
export const EVIDENCE_MODERATE = 0.5;
const GLOBAL_PRIOR = 3.5;


/**
 * White/sparkling/rosé have no meaningful tannin / dark-fruit signal — those
 * axes are absent, not zero-valued votes. Shared axes apply to every type.
 */
export function axisApplies(axis: FpKey, type: WineType): boolean {
  if (axis === "tannin" || axis === "fruit_dark")
    return type === "red" || type === "dessert";
  return true;
}

function activeAxesFor(type: WineType): FpKey[] {
  return RAX.filter((a) => axisApplies(a, type));
}

// ────────── Step 1: learn axis-importance ω via pairwise non-neg ridge ──────────

type OmegaFit = { omega: Record<FpKey, number>; active: FpKey[] };

/**
 * For every pair (i,j) of same-type rated wines:
 *   target g = |sᵢ - sⱼ| / 4  ∈ [0,1]
 *   features δₐ = (xᵢₐ - xⱼₐ)²
 *   pair weight w = wᵢ · wⱼ   (Canon–Nemesis pair carries 9× ordinary weight)
 * Solve non-negative ridge (min Σ w(g - Σ ω δ)² + λ Σ (ω-1)²) via
 * coordinate descent with clamping. λ = 10 / n_pairs shrinks strongly to
 * uniform when data is thin. Then clamp [0.25, 4.0] and renormalize so
 * Σ_active ω = |active|.
 *
 * Fallback: uniform ω = 1 when n < 4.
 */
function learnOmega(rated: RatedFp[], type: WineType): OmegaFit {
  const active = activeAxesFor(type);
  const uniform: Record<FpKey, number> = {} as Record<FpKey, number>;
  for (const a of RAX) uniform[a] = active.includes(a) ? 1 : 0;

  if (rated.length < 4) return { omega: uniform, active };

  // Build pairs
  type Pair = { g: number; d2: Record<FpKey, number>; w: number };
  const pairs: Pair[] = [];
  for (let i = 0; i < rated.length; i++) {
    for (let j = i + 1; j < rated.length; j++) {
      const a = rated[i], b = rated[j];
      const g = Math.abs(a.stars - b.stars) / 4;
      const d2: Record<FpKey, number> = {} as Record<FpKey, number>;
      for (const k of active) {
        const diff = a.fp[k] - b.fp[k];
        d2[k] = diff * diff;
      }
      pairs.push({ g, d2, w: (a.weight ?? 1) * (b.weight ?? 1) });
    }
  }
  if (pairs.length === 0) return { omega: uniform, active };

  // Per-axis independent relevance fit (Phase 2 spec correction). For each
  // axis a in isolation:
  //   ω_a = (Σ_pairs w·g·δ²_a + λ·1) / (Σ_pairs w·δ⁴_a + λ)
  // where g = |sᵢ−sⱼ|/4, δ²_a = (xᵢₐ−xⱼₐ)², w = wᵢ·wⱼ, λ = min(10/n_pairs, 1).
  // Fixed point: δ²_a = 0 for all pairs ⇒ num = den = λ ⇒ ω_a = 1.0 exactly
  // (uninformative axes rest at prior). Correlated informative axes each get
  // full credit for the variance they explain — joint-model coupling is
  // intentionally dropped because it forces co-varying informative axes to
  // share a budget and land below prior.
  const lambda = Math.min(10 / pairs.length, 1.0);
  const omega: Record<FpKey, number> = { ...uniform };
  for (const a of active) {
    let num = lambda; // λ · 1
    let den = lambda;
    for (const p of pairs) {
      const da = p.d2[a];
      num += p.w * p.g * da;
      den += p.w * da * da;
    }
    omega[a] = den > 0 ? Math.max(0, num / den) : 1;
  }


  // Clamp to [0.25, 4.0]. No renormalization.
  for (const k of active)
    omega[k] = Math.min(OMEGA_CLAMP[1], Math.max(OMEGA_CLAMP[0], omega[k]));
  for (const k of RAX) if (!active.includes(k)) omega[k] = 0;
  return { omega, active };
}


// ────────── Step 2: adaptive bandwidth h ──────────

function omegaDistance(
  a: Record<FpKey, number>,
  b: Record<FpKey, number>,
  omega: Record<FpKey, number>,
  active: FpKey[],
): number {
  let num = 0, den = 0;
  for (const k of active) {
    const w = omega[k];
    if (w <= 0) continue;
    const diff = a[k] - b[k];
    num += w * diff * diff;
    den += w;
  }
  return den > 0 ? Math.sqrt(num / den) : 0;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function pickBandwidth(rated: RatedFp[], fit: OmegaFit): number {
  if (rated.length < 3) return H_FALLBACK;
  const dists: number[] = [];
  for (let i = 0; i < rated.length; i++) {
    for (let j = i + 1; j < rated.length; j++) {
      dists.push(omegaDistance(rated[i].fp, rated[j].fp, fit.omega, fit.active));
    }
  }
  const raw = median(dists) / 2;
  return Math.min(H_CAP, Math.max(H_FLOOR, raw));
}

// ────────── Step 4 helper: unweighted per-type mean (excludes benchmark inflation) ──────────

function typeMean(rated: RatedFp[]): number {
  if (rated.length === 0) return GLOBAL_PRIOR;
  // Use raw stars — do NOT multiply by benchmark weights, so μᵤ reflects
  // the user's actual ordinary taste, not their crowning bias.
  const sum = rated.reduce((s, r) => s + r.stars, 0);
  return sum / rated.length;
}

function shrinkPrior(mean: number, n: number): number {
  // (n·μᵤ + 3·GLOBAL_PRIOR) / (n + 3)
  return (n * mean + 3 * GLOBAL_PRIOR) / (n + 3);
}

// ────────── Step 5: evidence tier ──────────

function evidenceTier(M: number): Recommendation["evidenceTier"] {
  if (M >= EVIDENCE_STRONG) return "strong";
  if (M >= EVIDENCE_MODERATE) return "moderate";
  return "exploratory";
}

// ────────── Per-type context (cached across candidates in one recommend() call) ──────────

type TypeCtx = {
  rated: RatedFp[];
  fit: OmegaFit;
  h: number;
  mu: number;
  muPrior: number;
};

function buildCtx(rated: RatedFp[], type: WineType): TypeCtx | null {
  const same = rated.filter((r) => r.type === type);
  if (same.length === 0) return null;
  const fit = learnOmega(same, type);
  const h = pickBandwidth(same, fit);
  const mu = typeMean(same);
  const muPrior = shrinkPrior(mu, same.length);
  return { rated: same, fit, h, mu, muPrior };
}

// ────────── Score one candidate ──────────

function scoreOne(cand: BottleFp, ctx: TypeCtx): Recommendation {
  const { rated, fit, h, muPrior } = ctx;
  const twoH2 = 2 * h * h;

  let num = 0;
  let M = 0;
  let bestK = -Infinity;
  let bestKAnchor: RatedFp | null = null;
  let bestSim = 0;
  let nearestByDist: RatedFp | null = null;
  let nearestDist = Infinity;

  // Nemesis reach tracking: repulsion reaches NEMESIS_RADIUS_MULT · h.
  // BASIN RULE: a Nemesis inside its reach only vetoes when the candidate
  // is closer to it than to any love (stars ≥ 4). Otherwise the candidate
  // sits in the "contested zone" — no veto, but flagged for UI caution.
  let nearNemesis: RatedFp | null = null;
  let nearNemesisDist = Infinity;
  let nearestPositive: RatedFp | null = null;
  let nearestPositiveDist = Infinity;
  const nemesisRadius = h * NEMESIS_RADIUS_MULT;
  const perAxisContribution: Record<string, number> = {};

  for (const r of rated) {
    const d = omegaDistance(cand.fp, r.fp, fit.omega, fit.active);
    const sim = Math.exp(-(d * d) / twoH2);
    const w = r.weight ?? 1;
    const k = w * Math.pow(sim, SHARPEN_GAMMA);
    num += k * r.stars;
    M += k;
    if (sim > bestSim) bestSim = sim;
    if (k > bestK) { bestK = k; bestKAnchor = r; }
    if (d < nearestDist) { nearestDist = d; nearestByDist = r; }
    if (r.nemesis && d < nemesisRadius && d < nearNemesisDist) {
      nearNemesisDist = d;
      nearNemesis = r;
    }
    // Nearest positive anchor (love) — stars ≥ 4 and not a Nemesis.
    if (!r.nemesis && r.stars >= 4 && d < nearestPositiveDist) {
      nearestPositiveDist = d;
      nearestPositive = r;
    }
  }

  // Basin decision: veto only if the near-Nemesis is strictly closer than
  // any love. Ties (or no love at all) → veto (a lonely candidate glued to
  // the Nemesis with no positive nearby has nowhere else to belong).
  const inNemesisReach = nearNemesis !== null;
  const nemesisWinsBasin =
    inNemesisReach && nearNemesisDist < nearestPositiveDist;

  let predicted = (num + PRIOR_ALPHA * muPrior) / (M + PRIOR_ALPHA);

  // Step 6: dislike guard — nearest anchor by ω-distance is a plain-dislike
  // we're sitting on top of. Cap so a lonely candidate glued to a 1★ can't
  // average its way to a middling score. Skips when nearest is a Nemesis
  // (that path is handled by the asymmetric veto below).
  if (nearestByDist && !nearestByDist.nemesis && nearestByDist.stars <= 2 && nearestDist < h) {
    const cap = nearestByDist.stars + 0.5;
    if (predicted > cap) predicted = cap;
  }

  predicted = Math.min(5, Math.max(1, predicted));
  const tier = evidenceTier(M);

  let vetoReason: VetoReason | null = null;
  let contestedReason: ContestedReason | null = null;
  if (nemesisWinsBasin && nearNemesis) {
    // Compute driving axes only on the veto path (small cost).
    for (const a of fit.active) {
      const diff = cand.fp[a] - nearNemesis.fp[a];
      perAxisContribution[a] = fit.omega[a] * diff * diff;
    }
    const ranked = Object.entries(perAxisContribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([a]) => a as FpKey);
    vetoReason = { nemesis: nearNemesis, distance: nearNemesisDist, drivingAxes: ranked };
  } else if (inNemesisReach && nearNemesis && nearestPositive) {
    contestedReason = {
      nemesis: nearNemesis,
      nemesisDistance: nearNemesisDist,
      nearestPositive,
      positiveDistance: nearestPositiveDist,
    };
  }

  return {
    bottle: cand,
    predicted,
    nearest: bestKAnchor,
    nearestIsCanon: !!bestKAnchor?.canon,
    maxSimilarity: bestSim,
    confidence: M / (M + PRIOR_ALPHA),
    evidence: M,
    evidenceTier: tier,
    vetoed: !!vetoReason,
    vetoReason,
    contested: !!contestedReason,
    contestedReason,
  };
}


// ────────── Public entry ──────────

export function recommend(
  rated: RatedFp[],
  unrated: BottleFp[],
  opts: { restrictToRatedTypes?: boolean } = {},
): Recommendation[] {
  if (rated.length === 0) return [];
  const restrict = opts.restrictToRatedTypes ?? true;

  const ratedTypes = new Set(rated.map((r) => r.type));
  const candidates = restrict
    ? unrated.filter((b) => ratedTypes.has(b.type))
    : unrated;

  // Build per-type context once.
  const ctxByType = new Map<WineType, TypeCtx | null>();
  for (const t of ratedTypes) ctxByType.set(t, buildCtx(rated, t));

  const results: Recommendation[] = [];
  for (const b of candidates) {
    let ctx = ctxByType.get(b.type);
    if (ctx === undefined) {
      ctx = buildCtx(rated, b.type);
      ctxByType.set(b.type, ctx);
    }
    if (!ctx) continue;
    results.push(scoreOne(b, ctx));
  }

  // Sort: non-vetoed first (by predicted desc); vetoed all sink below.
  // Within vetoed, sort by ascending veto distance (worst offender last-ish
  // is fine; the group is just "avoid").
  return results.sort((a, b) => {
    if (a.vetoed !== b.vetoed) return a.vetoed ? 1 : -1;
    if (a.vetoed && b.vetoed) {
      return (a.vetoReason?.distance ?? 0) - (b.vetoReason?.distance ?? 0);
    }
    if (b.predicted !== a.predicted) return b.predicted - a.predicted;
    // Tie-break: prefer candidates closer to an anchor (higher max similarity).
    return (b.maxSimilarity ?? 0) - (a.maxSimilarity ?? 0);
  });
}


// ────────── Dev-only diagnostic exports ──────────
// Tree-shaken out of production bundles: `process.env.NODE_ENV` is inlined
// as "production" by Vite at build time, so `__DEV` folds to `false` and the
// exports become `undefined` — the underlying functions have no other
// consumers in the client graph, so bundlers drop them. Kept for the Nemesis
// and Mutability phases (probe ω / h without shipping to production).
const __DEV: boolean =
  typeof process === "undefined" || process.env?.NODE_ENV !== "production";
export const __debug_learnOmega: typeof learnOmega | undefined = __DEV
  ? learnOmega
  : undefined;
export const __debug_pickBandwidth: typeof pickBandwidth | undefined = __DEV
  ? pickBandwidth
  : undefined;

// ────────── Public helpers for presentation-layer clustering (lanes.ts) ──────────
// These reuse the exact ω / h the recommender uses to score, so lane geometry
// matches scoring geometry. No engine changes — just exposing internals.

export type { TypeCtx };

export function buildTypeContext(rated: RatedFp[], type: WineType): TypeCtx | null {
  return buildCtx(rated, type);
}

/** ω-weighted distance between two fingerprints in the given type context. */
export function distanceInContext(
  a: Record<FpKey, number>,
  b: Record<FpKey, number>,
  ctx: TypeCtx,
): number {
  return omegaDistance(a, b, ctx.fit.omega, ctx.fit.active);
}

