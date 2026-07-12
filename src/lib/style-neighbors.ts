// Style neighbors — the closest calibrated cuvées to a subject wine's
// fingerprint under the user's learned ω metric. Reuses the exact same
// per-type context (ω, h) the recommender + matches use to score, so
// neighbor geometry matches match geometry. No engine changes.
//
// Two lists come out of one pass:
//   • unratedNeighbors  → discovery (main list, with predicted ★ + veto)
//   • cellarNeighbors   → your rated wines closest to the subject (with your ★)

import { useMemo } from "react";
import {
  useBottlesByIds,
  usePourCandidates,
  useRatings,
  bottleToFp,
  bottleType,
  isCalibrated,
  type BottleRow,
} from "@/hooks/use-palate-data";
import { useMyCanons } from "@/hooks/use-canon";
import {
  buildTypeContext,
  distanceInContext,
  recommend,
  BENCHMARK_WEIGHT,
  type BottleFp,
  type FpKey,
  type RatedFp,
  type Recommendation,
  type TypeCtx,
  type WineType,
} from "@/lib/recommender";
import {
  aggregateRated,
  aggregateCandidates,
  cuveeKey,
  type CuveeCandidate,
  type CuveeRated,
} from "@/lib/cuvee";

export type UnratedNeighbor = Recommendation & {
  cuvee: CuveeCandidate;
  distance: number;
  similarity: number;
};

export type CellarNeighbor = {
  cuvee: CuveeRated;
  distance: number;
  similarity: number;
};

export type StyleNeighborsResult = {
  subject: BottleRow | null;
  subjectFp: Record<FpKey, number> | null;
  subjectType: WineType | null;
  subjectCalibrated: boolean;
  ctx: TypeCtx | null;
  unratedNeighbors: UnratedNeighbor[];
  cellarNeighbors: CellarNeighbor[];
  loading: boolean;
  /** True when the query cannot run: no rated wines of this type, or
   *  subject fingerprint is uncalibrated. */
  unavailableReason: "uncalibrated" | "no-context" | null;
};

function similarityFor(distance: number, h: number): number {
  return Math.exp(-(distance * distance) / (2 * h * h));
}

/** Compute style neighbors for a subject bottle. Returns up to `limit` unrated
 *  cuvées and up to `cellarLimit` rated cuvées, both sorted by ω-distance
 *  ascending. Excludes the subject's own cuvée from both lists. */
export function useStyleNeighbors(
  subjectBottleId: string | null,
  limit = 10,
  cellarLimit = 25,
): StyleNeighborsResult {
  const { data: subjectBottles, isLoading: subjectLoading } = useBottlesByIds(
    subjectBottleId ? [subjectBottleId] : [],
  );
  const subject = subjectBottles?.[0] ?? null;

  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const { data: pool } = usePourCandidates();
  const { data: canons } = useMyCanons();

  const canonBottleIds = useMemo(
    () => new Set((canons ?? []).filter((c) => c.tier === "canon").map((c) => c.bottle_id)),
    [canons],
  );
  const nemesisBottleIds = useMemo(
    () => new Set((canons ?? []).filter((c) => c.tier === "nemesis").map((c) => c.bottle_id)),
    [canons],
  );

  const loading =
    subjectLoading ||
    !ratings ||
    (ratedIds.length > 0 && !ratedBottles) ||
    !pool;

  const result = useMemo<StyleNeighborsResult>(() => {
    if (!subject || !ratings || !pool) {
      return {
        subject: subject ?? null,
        subjectFp: null,
        subjectType: null,
        subjectCalibrated: false,
        ctx: null,
        unratedNeighbors: [],
        cellarNeighbors: [],
        loading: true,
        unavailableReason: null,
      };
    }

    const subjectType = bottleType(subject);
    const subjectFp = bottleToFp(subject);
    const subjectCalibrated = isCalibrated(subject);

    if (!subjectCalibrated) {
      return {
        subject, subjectFp, subjectType, subjectCalibrated: false,
        ctx: null, unratedNeighbors: [], cellarNeighbors: [],
        loading: false, unavailableReason: "uncalibrated",
      };
    }

    // Aggregate user's ratings → cuvées (same shape matches uses).
    const ratedRowsRaw: (RatedFp & { vintage: number | null })[] = (ratedBottles ?? []).map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage,
      fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
    }));
    const ratedCuvees = aggregateRated(ratedRowsRaw);
    const sameTypeRated = ratedCuvees.filter((c) => c.type === subjectType);

    // The subject's cuvée — exclude from both lists so a wine isn't its own neighbor.
    const subjectCuveeKey = cuveeKey(subject);

    // Per-type context (ω, h) — mirrors matches/pour exactly, including
    // benchmark weighting so Canon/Nemesis anchors shape the geometry the
    // same way for consistency.
    const ratedFp: RatedFp[] = sameTypeRated.map((r) => {
      const isCanon = r.bottleIds.some((id) => canonBottleIds.has(id));
      const isNemesis = r.bottleIds.some((id) => nemesisBottleIds.has(id));
      return {
        id: r.id, name: r.name, producer: r.producer, region: r.region,
        type: r.type, fp: r.fp, stars: r.stars,
        weight: isCanon || isNemesis ? BENCHMARK_WEIGHT : 1,
        canon: isCanon,
        nemesis: isNemesis,
      };
    });

    const ctx = ratedFp.length > 0 ? buildTypeContext(ratedFp, subjectType) : null;
    if (!ctx) {
      return {
        subject, subjectFp, subjectType, subjectCalibrated: true,
        ctx: null, unratedNeighbors: [], cellarNeighbors: [],
        loading: false, unavailableReason: "no-context",
      };
    }

    // ---------- Cellar neighbors (rated wines, sorted by distance) ----------
    const cellarNeighbors: CellarNeighbor[] = sameTypeRated
      .filter((c) => c.cuvee !== subjectCuveeKey)
      .map((c) => {
        const d = distanceInContext(subjectFp, c.fp, ctx);
        return { cuvee: c, distance: d, similarity: similarityFor(d, ctx.h) };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, cellarLimit);

    // ---------- Unrated neighbors (candidate pool, sorted by distance) ----------
    // 1) Aggregate candidates to cuvée, drop rated cuvées and the subject,
    //    drop uncalibrated (raw), keep same type.
    const ratedCuveeKeys = new Set(ratedCuvees.map((c) => c.cuvee));
    const candidatesRaw = pool.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage, fp: bottleToFp(b),
      critic_score: b.critic_score, price_band: b.price_band,
      raw: b.raw ?? false,
    }));
    const candCuvees = aggregateCandidates(candidatesRaw)
      .filter((c) => c.type === subjectType)
      .filter((c) => !ratedCuveeKeys.has(c.cuvee))
      .filter((c) => c.cuvee !== subjectCuveeKey)
      .filter((c) => !c.raw); // uncalibrated candidates excluded entirely

    // 2) Distance in ctx, ascending → take top 3× the limit so vetoed sinks
    //    don't starve the visible list.
    const byDistance = candCuvees
      .map((c) => ({ c, d: distanceInContext(subjectFp, c.fp, ctx) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, Math.max(limit * 3, 30));

    // 3) Score just this shortlist through the engine to get predicted +
    //    veto info (same code path matches uses; cheap on a small list).
    const candFp: BottleFp[] = byDistance.map(({ c }) => ({
      id: c.id, name: c.name, producer: c.producer, region: c.region,
      type: c.type, fp: c.fp,
    }));
    const recs = recommend(ratedFp, candFp);
    const cuveeById = new Map(byDistance.map(({ c }) => [c.id, c]));
    const distById = new Map(byDistance.map(({ c, d }) => [c.id, d]));

    const unratedNeighbors: UnratedNeighbor[] = recs
      .map((r): UnratedNeighbor | null => {
        const cuvee = cuveeById.get(r.bottle.id);
        const d = distById.get(r.bottle.id);
        if (!cuvee || d === undefined) return null;
        return { ...r, cuvee, distance: d, similarity: similarityFor(d, ctx.h) };
      })
      .filter((x): x is UnratedNeighbor => x !== null)
      // Re-sort by distance ascending — this is a "closest" list, not a
      // "highest predicted" list. Vetoed wines stay in place with Avoid
      // treatment at their true distance rank (per spec).
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);

    return {
      subject, subjectFp, subjectType, subjectCalibrated: true,
      ctx, unratedNeighbors, cellarNeighbors,
      loading: false, unavailableReason: null,
    };
  }, [subject, ratings, ratedBottles, pool, canonBottleIds, nemesisBottleIds, limit, cellarLimit]);

  return { ...result, loading: loading || result.loading };
}

/** Chip label consistent with matches (same thresholds on Gaussian similarity). */
export function similarityChip(sim: number): string {
  if (sim >= 0.85) return "strong match";
  if (sim >= 0.65) return "close match";
  if (sim >= 0.45) return "loose match";
  return "distant match";
}
