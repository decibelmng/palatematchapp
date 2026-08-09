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

/**
 * A style reading. An axis that is ABSENT from this object was never read —
 * it is not 0, and it is not 0.5. Missing axes are excluded from every
 * distance, similarity and ω fit, and the remaining axes are rescaled, so an
 * unread dimension contributes distance in neither direction. A wine
 * genuinely at 0.5 must stay distinguishable from one we failed to read.
 * Build these with fpOf / bottleToFp — never with a `?? 0` or `?? 0.5`.
 */
export type FpVec = { [K in FpKey]?: number };

/** An axis is readable only if a real number is present for it. */
export function hasAxis(fp: FpVec, k: FpKey): boolean {
  return Number.isFinite(fp[k] as number);
}

export type WineType = "red" | "white" | "sparkling" | "rose" | "dessert";

export type BottleFp = {
  id: string;
  name: string;
  producer?: string | null;
  region?: string | null;
  type: WineType;
  fp: FpVec;
  /** Reading provenance (bottles.fp_pipeline). Present only where a caller
   *  selects it; absent is not a claim either way. */
  fpPipeline?: string | null;
  /**
   * Years between the vintage on the list and the vintage of the row this
   * reading actually came from. Absent (or null) means the reading is for the
   * exact bottle in hand — NOT that the gap is zero-but-known. A present gap
   * only ever weakens confidence in the reading; it never changes evidence
   * mass M, because M is a claim about how much of the person's own rated set
   * sits nearby and that claim is unaffected by which year we read.
   */
  vintageGap?: number | null;
};


export type RatedFp = BottleFp & {
  stars: number;
  /** Per-sample weight in the kernel regression + ridge fit (default 1). */
  weight?: number;
  /** Marks this rated wine as a Canon anchor (drives explanation copy). */
  canon?: boolean;
  /** Marks this rated wine as a Nemesis anchor (drives veto + explanation). */
  nemesis?: boolean;
  /** True for synthetic style-quiz seeds. Seeds participate in KERNEL
   *  scoring (they mark a region of style space the user likes) but are
   *  EXCLUDED from the pairwise omega ridge fit — a fabricated stars=4
   *  is not a real observation and would corrupt |Δstars| contrasts.
   *  Filtered in learnOmega before any pair is built. See Invariant 1. */
  isSeed?: boolean;
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

/**
 * Axes retired from SCORING while still stored and written.
 *
 * `fresh` is retired: recovered reviewer prose addresses it on 15% of wines,
 * and where both are present it correlates with `acid` at 0.53 (reds) / 0.74
 * (whites) — reviewers do not write freshness as distinct from acidity because
 * it largely is acidity. An axis that is absent 85% of the time and collinear
 * when present contributes noise plus a rescaling penalty, not signal.
 *
 * This is deliberately NOT `axisApplies`: fp_fresh is still scored, still
 * written, and still displayed. It is excluded from the metric only, so the
 * decision is reversible the moment a note source that discusses freshness
 * independently arrives.
 */
export const RETIRED_AXES: readonly FpKey[] = ["fresh"];

function activeAxesFor(type: WineType): FpKey[] {
  return RAX.filter((a) => axisApplies(a, type) && !RETIRED_AXES.includes(a));
}

/**
 * Minimum axes two readings must BOTH carry to be treated as neighbours.
 *
 * A kernel weight computed from two shared dimensions is noise with a
 * confidence interval wider than the scale it reports. Below this floor the
 * pair has no usable geometry, so the distance is Infinity — the same
 * convention as no overlap at all — rather than a small number that
 * masquerades as similarity.
 */
export const MIN_COMPARABLE_AXES = 3;

/**
 * A reading this thin may be RANKED but may never be THE CALL.
 *
 * v3 reads a wine from one human tasting note and returns null for every axis
 * the note does not address. A note that yields three or fewer active axes has
 * not described a style — it has described a fragment of one. Such a wine can
 * still be compared (MIN_COMPARABLE_AXES = 3 is met) and can still appear as
 * an alternate, but naming it as the single bottle to order claims a confidence
 * the read does not carry.
 *
 * Counted from the reading itself, not from a column: post-swap the live fp_*
 * values ARE the v3 values, so a present axis is a read axis. On the v1 grid
 * every axis is dense, so nothing is thin and the rule is inert until the swap.
 */
export const THIN_READ_MAX_AXES = 3;

/** How many SCORED axes this reading carries for its type (retired axes excluded). */
export function axesRead(fp: FpVec | null | undefined, type: WineType): number {
  if (!fp) return 0;
  return activeAxesFor(type).reduce((n, a) => (hasAxis(fp, a) ? n + 1 : n), 0);
}

/**
 * True when the reading is too thin to be named as the Call.
 *
 * No reading object at all is a different fact from a thin one — an absent fp
 * means this row never went through the note scorer — so it is NOT thin here
 * and is judged by the ordinary rules.
 */
export function isThinRead(fp: FpVec | null | undefined, type: WineType): boolean {
  if (!fp) return false;
  return axesRead(fp, type) <= THIN_READ_MAX_AXES;
}

/**
 * A reading taken from a review that may describe a sibling bottle.
 *
 * The v3 shadow run scores these rather than leaving 10k rows on the old
 * typicity grid, but until their spread is measured against the clean set the
 * reading is not trusted enough to name one bottle to order. Same treatment as
 * a thin read: rankable, never the Call.
 */
export const AMBIGUOUS_JOIN_PIPELINE = "note_v3_ambiguous_join";

export function isAmbiguousJoinRead(bottle: { fpPipeline?: string | null }): boolean {
  return bottle.fpPipeline === AMBIGUOUS_JOIN_PIPELINE;
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

  // Invariant 1: omega comes from a per-axis ridge over REAL observations.
  // Quiz seeds (isSeed) enter the kernel — they legitimately mark a region
  // of style space — but they never generate |Δstars| contrasts. Their
  // stars=4 label is a placeholder, not a measurement, so filter here.
  const real = rated.filter((r) => !r.isSeed);
  if (real.length < 4) return { omega: uniform, active };

  // Build pairs
  type Pair = { g: number; d2: Partial<Record<FpKey, number>>; w: number };
  const pairs: Pair[] = [];
  for (let i = 0; i < real.length; i++) {
    for (let j = i + 1; j < real.length; j++) {
      const a = real[i], b = real[j];
      const g = Math.abs(a.stars - b.stars) / 4;
      // An axis missing on either side yields NO contrast for that axis —
      // the pair simply does not vote on it. It must never contribute a
      // fabricated (x - 0)² of manufactured magnitude.
      const d2: Partial<Record<FpKey, number>> = {};
      for (const k of active) {
        if (!hasAxis(a.fp, k) || !hasAxis(b.fp, k)) continue;
        const diff = (a.fp[k] as number) - (b.fp[k] as number);
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
      if (da === undefined) continue; // axis unread in this pair
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

/**
 * ω-weighted distance over the axes BOTH readings actually carry, rescaled by
 * the weight of those axes only (den). An axis missing on either side is
 * excluded rather than substituted, so it moves the distance in neither
 * direction — the same convention pick-alternates uses.
 *
 * Too few comparable axes returns Infinity, not 0: two wines without readable
 * overlap are not neighbours, and calling them identical is the
 * manufactured-distance bug in its worst form. See MIN_COMPARABLE_AXES.
 */
export function omegaDistance(
  a: FpVec,
  b: FpVec,
  omega: Record<FpKey, number>,
  active: FpKey[],
): number {
  let num = 0, den = 0, shared = 0;
  for (const k of active) {
    const w = omega[k];
    if (w <= 0) continue;
    if (!hasAxis(a, k) || !hasAxis(b, k)) continue;
    const diff = (a[k] as number) - (b[k] as number);
    num += w * diff * diff;
    den += w;
    shared++;
  }
  // Neighbour floor. Fewer than MIN_COMPARABLE_AXES shared readings is not a
  // weak neighbour, it is not a neighbour: rescaling a 2-axis distance over a
  // 2-axis weight budget produces a confident-looking number from nothing.
  if (shared < MIN_COMPARABLE_AXES || den <= 0) return Infinity;
  return Math.sqrt(num / den);
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
      if (!hasAxis(cand.fp, a) || !hasAxis(nearNemesis.fp, a)) continue;
      const diff = (cand.fp[a] as number) - (nearNemesis.fp[a] as number);
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
  a: FpVec,
  b: FpVec,
  ctx: TypeCtx,
): number {
  return omegaDistance(a, b, ctx.fit.omega, ctx.fit.active);
}

