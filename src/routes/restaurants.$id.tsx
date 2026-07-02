import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ListControls } from "@/components/ListControls";
import { DrinkingGroupSelector } from "@/components/DrinkingGroupSelector";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import { useBottlesByIds, useRatings, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { useGroupSelection, useGroupPredict, type GroupCandidateInput } from "@/hooks/use-friends";
import { recommend, type BottleFp, type RatedFp, type WineType } from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";
import { getRestaurantWinesFn } from "@/lib/restaurants.functions";
import { applyControls, normalizePrice, isGreatValue, DEFAULT_CONTROLS, type Controls } from "@/lib/list-controls";
import type { GroupScored } from "@/lib/group.functions";

export const Route = createFileRoute("/restaurants/$id")({
  ssr: false,
  component: RestaurantDetail,
});

const TYPE_ORDER: WineType[] = ["red", "white", "sparkling", "rose", "dessert"];
const TYPE_LABEL: Record<WineType, string> = {
  red: "Reds", white: "Whites", sparkling: "Sparkling", rose: "Rosés", dessert: "Dessert",
};

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function freshnessLabel(days: number): string {
  if (days < 1) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function RestaurantDetail() {
  const { id } = Route.useParams();
  const fn = useServerFn(getRestaurantWinesFn);
  const { data, isLoading } = useQuery({
    queryKey: ["restaurant", id],
    queryFn: () => fn({ data: { restaurant_id: id } }),
    staleTime: 30_000,
  });

  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);

  const group = useGroupSelection();
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);

  // Predict per-user stars for every wine on this list.
  const enrichedByType = useMemo(() => {
    if (!data) return null;

    const ratedRowsRaw: RatedFp[] = (ratedBottles ?? []).map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), fp: bottleToFp(b),
      stars: ratings!.find((r) => r.bottle_id === b.id)?.stars ?? 3,
    }));
    const rated = aggregateRated(ratedRowsRaw);
    const enoughRatings = ratedRowsRaw.length >= 3;

    // Freshness cutoff = the most-recent scan date on this restaurant.
    const mostRecent = data.wines.reduce<Date | null>((acc, w) => {
      const d = new Date(w.last_seen_at);
      return !acc || d > acc ? d : acc;
    }, null);

    const byType = new Map<WineType, typeof data.wines>();
    for (const w of data.wines) {
      const t = (w.bottle.type as WineType) || "red";
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(w);
    }

    const sections = TYPE_ORDER.filter((t) => byType.has(t)).map((type) => {
      const wines = byType.get(type)!;
      const candFps: BottleFp[] = wines.map((w) => ({
        id: w.bottle.id, name: w.bottle.name, producer: w.bottle.producer,
        region: w.bottle.region, type, fp: bottleToFp(w.bottle),
      }));
      let predByBottle = new Map<string, number>();
      if (enoughRatings) {
        const recs = recommend(candFps, rated, { k: 12, minWeight: 0.05 });
        for (const r of recs) predByBottle.set(r.bottle.id, r.predicted);
      }

      const rows = wines.map((w) => {
        const priceRaw = w.menu_price ?? (w.menu_price_amount != null ? String(w.menu_price_amount) : null);
        const price = normalizePrice(priceRaw);
        const days = daysAgo(w.last_seen_at);
        const isStale = mostRecent
          ? new Date(w.last_seen_at).getTime() < mostRecent.getTime() - 24 * 3600 * 1000
          : false;
        const predicted = predByBottle.get(w.bottle.id) ?? null;
        const isCatalog = !(w.bottle.source ?? "").includes("unverified");
        const priced = {
          price_amount: price.amount,
          price_band: price.band,
          price_display: price.display,
          isCatalog,
          predicted: predicted ?? 0,
        };
        return {
          rw: w,
          bottle: w.bottle,
          predicted,
          price_display: price.display,
          days,
          isStale,
          isCatalog,
          priced,
          greatValue: predicted != null && isGreatValue(priced),
        };
      });

      return { type, rows, enoughRatings };
    });

    return sections;
  }, [data, ratedBottles, ratings]);

  // Group scoring
  const candidatesForGroup: GroupCandidateInput[] = useMemo(() => {
    if (!data) return [];
    return data.wines.map((w) => ({
      id: w.bottle.id,
      name: w.bottle.name,
      producer: w.bottle.producer,
      region: w.bottle.region,
      type: (w.bottle.type as WineType) || "red",
      fp: bottleToFp(w.bottle),
    }));
  }, [data]);

  const groupPred = useGroupPredict(group.friendIds, candidatesForGroup);
  const groupActive = group.friendIds.length > 0;
  const groupScores = groupPred.data ?? null;


  if (isLoading || !data) {
    return <p className="pt-6 text-sm text-muted-foreground">Loading…</p>;
  }

  const { restaurant, wines } = data;

  return (
    <div className="pt-4">
      <Link to="/restaurants" className="text-xs text-muted-foreground hover:text-foreground">← All restaurants</Link>
      <h1 className="font-serif text-2xl mt-2">{restaurant.name}</h1>
      {restaurant.city && <p className="text-xs text-muted-foreground">{restaurant.city}</p>}
      <p className="mt-1 text-xs text-muted-foreground">
        {wines.length} wine{wines.length === 1 ? "" : "s"} tracked from community scans.
      </p>

      {wines.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No wines recorded yet.</p>
      ) : (
        <>
          <div className="mt-5">
            <DrinkingGroupSelector
              selectedIds={group.friendIds}
              onToggle={group.toggle}
              onClear={group.clear}
              onSet={group.set}
            />
          </div>

          <div className="mt-4">
            <ListControls value={controls} onChange={setControls} />
          </div>

          <div className="mt-5 space-y-8">
            {(enrichedByType ?? []).map((section) => {
              const priced = section.rows.map((r) => ({
                key: r.rw.id,
                row: r,
                priceable: { price: r.price_amount, predicted: r.predicted ?? 0 },
                controlMatch: r.isCatalog,
              }));
              // Apply controls (price sort/filter, confidence)
              const filtered = applyControls(priced.map((p) => ({
                priced: p.priceable,
                catalog: p.controlMatch,
                key: p.key,
              })), controls);
              const visibleKeys = new Set(filtered.map((f) => f.key));
              const rows = section.rows.filter((r) => visibleKeys.has(r.rw.id));

              return (
                <section key={section.type}>
                  <div className="flex items-center gap-2">
                    <WineTypeBadge type={section.type} />
                    <h2 className="font-serif text-lg">{TYPE_LABEL[section.type]}</h2>
                    <span className="text-xs text-muted-foreground">({rows.length})</span>
                  </div>

                  {rows.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground italic">Nothing matches those filters.</p>
                  ) : (
                    <ul className="mt-3 divide-y divide-border">
                      {rows.map((r) => {
                        const g = groupActive && groupScores ? groupScores.get(r.bottle.id) ?? null : null;
                        return (
                          <li key={r.rw.id} className="py-3 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm leading-tight truncate">{r.bottle.name}</p>
                                {!r.isCatalog && (
                                  <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-border bg-muted text-muted-foreground">
                                    community
                                  </span>
                                )}
                                {r.greatValue && (
                                  <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                    great value
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">
                                {[r.bottle.producer, r.bottle.region, r.price_display].filter(Boolean).join(" · ")}
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {r.isStale ? (
                                  <span className="italic">last seen {freshnessLabel(r.days)} — confirm availability</span>
                                ) : (
                                  <span>seen {freshnessLabel(r.days)}</span>
                                )}
                              </p>
                              {g && (
                                <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                                  {g.per_person.map((p, i) => (
                                    <span key={p.user_id}>
                                      {i > 0 && <span className="opacity-50"> · </span>}
                                      <span className="text-foreground/80">{p.display_name}</span>{" "}
                                      {p.predicted.toFixed(1)}
                                    </span>
                                  ))}
                                </p>
                              )}
                            </div>
                            {g ? (
                              <div className="shrink-0 text-right">
                                <span className="font-serif text-primary text-xl">{g.group_min.toFixed(1)}</span>
                                <span className="text-primary text-sm">★</span>
                                <p className="text-[10px] text-muted-foreground">avg {g.group_avg.toFixed(1)}</p>
                              </div>
                            ) : section.enoughRatings && r.predicted != null ? (
                              <div className="shrink-0 text-right">
                                <span className="font-serif text-primary text-xl">{r.predicted.toFixed(1)}</span>
                                <span className="text-primary text-sm">★</span>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
