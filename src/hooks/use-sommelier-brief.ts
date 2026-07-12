import { useMemo } from "react";
import { useMyCanons } from "@/hooks/use-canon";
import {
  useBottlesByIds,
  useRatings,
  bottleToValues,
  bottleToFp,
  bottleType,
} from "@/hooks/use-palate-data";
import { axesFor, type RatedBottle } from "@/lib/palate";
import type { RatedFp } from "@/lib/recommender";
import {
  buildFullBrief,
  type BriefBenchmark,
  type FullBrief,
  type TypeBriefInputs,
} from "@/lib/sommelier-brief";

/**
 * Assemble the deterministic "For your sommelier" brief from live data.
 * Same logic used to live inline in the home route — extracted so the
 * Share sheet and the Scan flow render an identical brief, palate-version
 * keyed via the underlying rating/canon queries.
 */
export function useSommelierBrief(): FullBrief {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(
    () => (ratings ?? []).map((r) => r.bottle_id),
    [ratings],
  );
  const { data: bottles } = useBottlesByIds(ratedIds);
  const { data: canons } = useMyCanons();

  return useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const canonBottleIds = new Set(
      (canons ?? []).filter((c) => c.tier === "canon").map((c) => c.bottle_id),
    );
    const nemesisBottleIds = new Set(
      (canons ?? []).filter((c) => c.tier === "nemesis").map((c) => c.bottle_id),
    );

    const redRated: RatedBottle[] = [];
    const whiteRated: RatedBottle[] = [];
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b) continue;
      const t = bottleType(b);
      const canon = canonBottleIds.has(b.id);
      if (t === "red") redRated.push({ stars: r.stars, values: bottleToValues(b, "red"), canon });
      else if (t === "white") whiteRated.push({ stars: r.stars, values: bottleToValues(b, "white"), canon });
    }

    const ratedFpAll: RatedFp[] = [];
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b) continue;
      ratedFpAll.push({
        id: b.id,
        name: b.name,
        producer: b.producer,
        region: b.region,
        type: bottleType(b),
        fp: bottleToFp(b),
        stars: r.stars,
        canon: canonBottleIds.has(b.id),
        nemesis: nemesisBottleIds.has(b.id),
      });
    }

    const toBench = (
      rows: typeof canons,
    ): Record<"red" | "white", BriefBenchmark[]> => {
      const out: Record<"red" | "white", BriefBenchmark[]> = { red: [], white: [] };
      for (const c of rows ?? []) {
        const b = byId.get(c.bottle_id);
        if (!b) continue;
        const t = bottleType(b);
        if (t !== "red" && t !== "white") continue;
        out[t].push({
          id: c.id,
          bottleId: c.bottle_id,
          name: b.name,
          producer: b.producer,
          region: b.region,
          fp: bottleToFp(b),
          createdAt: c.created_at,
        });
      }
      return out;
    };

    const canonsByType = toBench((canons ?? []).filter((c) => c.tier === "canon"));
    const nemesesByType = toBench((canons ?? []).filter((c) => c.tier === "nemesis"));

    const redInput: TypeBriefInputs | null = redRated.length > 0 ? {
      type: "red",
      rated: redRated,
      ratedFp: ratedFpAll.filter((r) => r.type === "red"),
      canons: canonsByType.red,
      nemeses: nemesesByType.red,
    } : null;
    const whiteInput: TypeBriefInputs | null = whiteRated.length > 0 ? {
      type: "white",
      rated: whiteRated,
      ratedFp: ratedFpAll.filter((r) => r.type === "white"),
      canons: canonsByType.white,
      nemeses: nemesesByType.white,
    } : null;

    // axesFor referenced to preserve import — keeps future extensions typed.
    void axesFor;

    return buildFullBrief({ red: redInput, white: whiteInput });
  }, [bottles, ratings, canons]);
}
