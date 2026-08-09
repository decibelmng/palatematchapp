// Keeps profiles.palate_code_red / _white in step with the live computation.
//
// This used to run only on /palate, so a row went stale for anyone who never
// opened that screen — and every reader of those columns (public profiles,
// invites, friend rows, overlap suggestions) saw an all-unresolved code.
// Mounted from AppShell, it recomputes from the cached ratings/bottles
// queries on any app open and writes when the result is real.

import { useMemo } from "react";
import { useMyCanons } from "@/hooks/use-canon";
import {
  bottleToValues,
  bottleType,
  useBottlesByIds,
  usePersistCode,
  useRatings,
} from "@/hooks/use-palate-data";
import { axesFor, computeCode, type RatedBottle } from "@/lib/palate";

export function usePalateCodeSync() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles } = useBottlesByIds(ratedIds);
  const { data: canons } = useMyCanons();

  const canonIds = useMemo(
    () => new Set((canons ?? []).filter((c) => c.tier === "canon").map((c) => c.bottle_id)),
    [canons],
  );

  const { redRated, whiteRated } = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const red: RatedBottle[] = [];
    const white: RatedBottle[] = [];
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b) continue;
      const t = bottleType(b);
      const canon = canonIds.has(b.id);
      if (t === "red") red.push({ stars: r.stars, values: bottleToValues(b, "red"), canon });
      else if (t === "white") white.push({ stars: r.stars, values: bottleToValues(b, "white"), canon });
    }
    return { redRated: red, whiteRated: white };
  }, [bottles, ratings, canonIds]);

  const red = useMemo(() => computeCode(redRated, axesFor("red")), [redRated]);
  const white = useMemo(() => computeCode(whiteRated, axesFor("white")), [whiteRated]);

  // Only write once the rated bottles have actually loaded — otherwise the
  // computation is unresolved by construction and the guard would skip it.
  const loaded = (ratings?.length ?? 0) === 0 || (bottles?.length ?? 0) > 0;
  usePersistCode(red.code, white.code, loaded ? ratings?.length ?? 0 : 0);
}
