import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useAllBottlesPaged, useBottlesByIds, useRatings, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { recommend, type BottleFp, type RatedFp } from "@/lib/recommender";

export const Route = createFileRoute("/pour")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Pour these next — Palate Match" },
      { name: "description", content: "Bottles you haven't tried, ranked by how likely you are to love them." },
    ],
  }),
  component: () => <AuthGate><Pour /></AuthGate>,
});

function Pour() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const { data: pool } = useAllBottlesPaged();

  const recs = useMemo(() => {
    if (!ratedBottles || !ratings || !pool || ratings.length === 0) return [];
    const ratedIdSet = new Set(ratedIds);
    const ratedRows: RatedFp[] = ratedBottles.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b),
      fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
    }));
    const unratedRows: BottleFp[] = pool
      .filter((b) => !ratedIdSet.has(b.id))
      .map((b) => ({
        id: b.id, name: b.name, producer: b.producer, region: b.region,
        type: bottleType(b),
        fp: bottleToFp(b),
      }));
    return recommend(ratedRows, unratedRows).slice(0, 25);
  }, [ratedBottles, ratings, ratedIds, pool]);


  const nRated = ratings?.length ?? 0;
  const fewLow = (ratings ?? []).filter((r) => r.stars <= 2).length === 0;
  const distinctStars = new Set((ratings ?? []).map((r) => r.stars)).size;
  const noVariance = nRated >= 2 && distinctStars === 1;
  const loading = !ratings || (ratedIds.length > 0 && !ratedBottles) || !pool;
  const onlyStar = noVariance ? [...new Set((ratings ?? []).map((r) => r.stars))][0] : null;

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pour these next</p>
      <h1 className="font-serif text-3xl mt-2">Bottles you'd likely love</h1>

      {nRated === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-card/60 p-5">
          <p className="text-sm text-muted-foreground">
            Rate a few bottles first — we'll predict from there.
          </p>
          <Link to="/rate" className="mt-4 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">
            Go rate
          </Link>
        </div>
      ) : loading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading recommendations…</p>
      ) : (
        <>
          {noVariance && (
            <div className="mt-4 rounded-xl border border-border bg-card/60 p-4">
              <p className="text-sm">
                Every wine you've rated is <span className="text-primary">{onlyStar}★</span>.
                The engine needs contrast to learn your palate — try rating a wine you only liked OK (3★) or one you didn't enjoy (1–2★).
              </p>
              <Link to="/rate" className="mt-3 inline-block text-xs uppercase tracking-wider text-primary">
                Rate more →
              </Link>
            </div>
          )}
          {!noVariance && (nRated < 6 || fewLow) && (
            <p className="mt-3 text-xs text-muted-foreground italic">
              {fewLow
                ? "Tip: rate some wines you disliked too — it sharpens predictions for unusual styles."
                : "Predictions get sharper with more ratings."}
            </p>
          )}
          <ul className="mt-6 divide-y divide-border">
            {recs.map((r) => (
              <li key={r.bottle.id} className="py-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium leading-tight truncate">{r.bottle.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[r.bottle.producer, r.bottle.region].filter(Boolean).join(" · ")}
                  </p>
                  {r.nearest && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      like your {r.nearest.stars}★ <span className="text-foreground/80">{r.nearest.name}</span>
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span className="font-serif text-primary text-xl">{r.predicted.toFixed(1)}</span>
                  <span className="text-primary text-sm">★</span>
                </div>
              </li>
            ))}
            {recs.length === 0 && (
              <li className="py-6 text-sm text-muted-foreground">No unrated bottles in the catalogue yet.</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
