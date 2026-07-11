import { useCallback } from "react";
import {
  BENCHMARK_WEIGHT,
  buildTypeContext,
  distanceInContext,
  type RatedFp,
} from "@/lib/recommender";
import { bottleToFp, bottleType, useRatings, useBottlesByIds, type BottleRow } from "./use-palate-data";
import { useMyCanons } from "./use-canon";
import { useTypeCentroids } from "./use-type-centroids";

export type GenericVerdict = {
  distance: number;
  h: number;
  generic: boolean;
};

/** Returns a synchronous predicate + async confirm helper for crown-time
 *  generic-fingerprint warnings. Uses the promoting user's own ω/h context
 *  (same math the recommender uses) against the catalog type centroid. */
export function useGenericWarning() {
  const { data: ratings } = useRatings();
  const ratedIds = (ratings ?? []).map((r) => r.bottle_id);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const { data: centroids } = useTypeCentroids();
  const { data: canons } = useMyCanons();

  const evaluate = useCallback(
    (bottle: BottleRow): GenericVerdict | null => {
      if (!ratings || !ratedBottles || !centroids) return null;
      const type = bottleType(bottle);
      const centroid = centroids[type];
      if (!centroid) return null;

      const canonSet = new Set(
        (canons ?? []).filter((c) => c.tier === "canon").map((c) => c.bottle_id),
      );
      const nemSet = new Set(
        (canons ?? []).filter((c) => c.tier === "nemesis").map((c) => c.bottle_id),
      );

      const rated: RatedFp[] = ratedBottles
        .filter((b) => bottleType(b) === type)
        .map((b) => {
          const stars = ratings.find((r) => r.bottle_id === b.id)?.stars ?? 3;
          const isC = canonSet.has(b.id);
          const isN = nemSet.has(b.id);
          return {
            id: b.id,
            name: b.name,
            producer: b.producer,
            region: b.region,
            type,
            fp: bottleToFp(b),
            stars,
            weight: isC || isN ? BENCHMARK_WEIGHT : 1,
            canon: isC,
            nemesis: isN,
          };
        });

      const ctx = buildTypeContext(rated, type);
      if (!ctx) return null;
      const d = distanceInContext(bottleToFp(bottle), centroid, ctx);
      return { distance: d, h: ctx.h, generic: d < ctx.h };
    },
    [ratings, ratedBottles, centroids, canons],
  );

  /** Returns true if it's safe to proceed (either not generic, or user confirmed).
   *  Uses window.confirm — non-blocking to the pipeline (no version bump if declined). */
  const confirmIfGeneric = useCallback(
    async (bottle: BottleRow): Promise<boolean> => {
      const v = evaluate(bottle);
      if (!v || !v.generic) return true;
      const msg =
        `This wine's profile looks generic in our catalog — ` +
        `its recommendations may be unfocused. Crown anyway?\n\n` +
        `(distance ${v.distance.toFixed(3)} < bandwidth h ${v.h.toFixed(3)})`;
      return typeof window !== "undefined" ? window.confirm(msg) : true;
    },
    [evaluate],
  );

  return { evaluate, confirmIfGeneric };
}
