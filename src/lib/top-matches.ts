import { useMemo } from "react";
import { usePourCandidates, useBottlesByIds, useRatings, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { recommend, type BottleFp, type RatedFp, type Recommendation } from "@/lib/recommender";
import { aggregateRated, aggregateCandidates, type CuveeCandidate, type CuveeRated } from "@/lib/cuvee";

export type TopMatch = Recommendation & { cuvee: CuveeCandidate; nearestCuvee: CuveeRated | null };

/** Compute top personalized matches across all wine types the user has rated.
 *  Shares candidate loading and recommender wiring with /pour so the ranking
 *  is identical (per-type recommender pass, cuvée-aggregated). */
export function useTopMatches(limit = 5): { data: TopMatch[]; loading: boolean; hasRatings: boolean } {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const { data: pool } = usePourCandidates();

  const loading = !ratings || (ratedIds.length > 0 && !ratedBottles) || !pool;
  const hasRatings = (ratings?.length ?? 0) > 0;

  const data = useMemo<TopMatch[]>(() => {
    if (!ratings || !pool || ratings.length === 0) return [];

    const ratedRowsRaw: RatedFp[] = (ratedBottles ?? []).map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b),
      fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
    }));
    const ratedCuvees = aggregateRated(
      ratedRowsRaw.map((r, i) => ({ ...r, vintage: (ratedBottles ?? [])[i]?.vintage ?? null })),
    );
    const ratedCuveeKeys = new Set(ratedCuvees.map((c) => c.cuvee));

    const candidatesRaw = pool.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage, fp: bottleToFp(b),
      critic_score: b.critic_score, price_band: b.price_band,
    }));
    const allCuvees = aggregateCandidates(candidatesRaw).filter((c) => !ratedCuveeKeys.has(c.cuvee));

    // Per-type recommender pass, then merge & take top N by predicted stars.
    const merged: TopMatch[] = [];
    const ratedTypes = new Set(ratedCuvees.map((r) => r.type));
    for (const type of ratedTypes) {
      const cands = allCuvees.filter((c) => c.type === type);
      const sameTypeRated = ratedCuvees.filter((r) => r.type === type);
      if (cands.length === 0 || sameTypeRated.length === 0) continue;
      const ratedFp: RatedFp[] = sameTypeRated.map((r) => ({
        id: r.id, name: r.name, producer: r.producer, region: r.region,
        type: r.type, fp: r.fp, stars: r.stars,
      }));
      const candFp: BottleFp[] = cands.map((c) => ({
        id: c.id, name: c.name, producer: c.producer, region: c.region,
        type: c.type, fp: c.fp,
      }));
      const recs = recommend(ratedFp, candFp).slice(0, limit * 3);
      const candById = new Map(cands.map((c) => [c.id, c]));
      const ratedById = new Map(sameTypeRated.map((r) => [r.id, r]));
      for (const r of recs) {
        const cuvee = candById.get(r.bottle.id);
        if (!cuvee) continue;
        merged.push({ ...r, cuvee, nearestCuvee: r.nearest ? ratedById.get(r.nearest.id) ?? null : null });
      }
    }
    merged.sort((a, b) => {
      if (b.predicted !== a.predicted) return b.predicted - a.predicted;
      return (b.maxSimilarity ?? 0) - (a.maxSimilarity ?? 0);
    });
    return merged.slice(0, limit);
  }, [ratings, ratedBottles, pool, limit]);

  return { data, loading, hasRatings };
}
