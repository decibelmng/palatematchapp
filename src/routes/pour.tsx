import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AuthGate } from "@/components/AuthGate";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import { useAllBottlesPaged, useBottlesByIds, useRatings, bottleToFp, bottleType, type BottleRow } from "@/hooks/use-palate-data";
import { recommend, type BottleFp, type RatedFp, type Recommendation, type WineType } from "@/lib/recommender";

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

const TYPE_ORDER: WineType[] = ["red", "white", "sparkling", "rose", "dessert"];
const TYPE_LABEL: Record<WineType, string> = {
  red: "Reds for you",
  white: "Whites for you",
  sparkling: "Sparkling for you",
  rose: "Rosés for you",
  dessert: "Dessert wines for you",
};
const TYPE_BADGE: Record<WineType, string> = {
  red: "Red",
  white: "White",
  sparkling: "Sparkling",
  rose: "Rosé",
  dessert: "Dessert",
};

type Section =
  | { type: WineType; mode: "personalized"; nSameType: number; items: Recommendation[] }
  | { type: WineType; mode: "fallback"; nSameType: 0; items: { bottle: BottleFp; critic: number | null }[] };

function Pour() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const { data: pool } = useAllBottlesPaged();

  const sections: Section[] = useMemo(() => {
    if (!ratings || !pool) return [];
    const ratedIdSet = new Set(ratedIds);
    const ratedRows: RatedFp[] = (ratedBottles ?? []).map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b),
      fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
    }));

    // Group catalog candidates by type.
    const byType = new Map<WineType, BottleRow[]>();
    for (const b of pool) {
      if (ratedIdSet.has(b.id)) continue;
      const t = bottleType(b);
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t)!.push(b);
    }

    const out: Section[] = [];
    for (const type of TYPE_ORDER) {
      const cands = byType.get(type);
      if (!cands || cands.length === 0) continue;
      const sameTypeRated = ratedRows.filter((r) => r.type === type);
      const candFp: BottleFp[] = cands.map((b) => ({
        id: b.id, name: b.name, producer: b.producer, region: b.region,
        type, fp: bottleToFp(b),
      }));

      if (sameTypeRated.length === 0) {
        // Neutral fallback: rank by critic_score.
        const ranked = cands
          .map((b, i) => ({
            bottle: candFp[i],
            critic: typeof b.critic_score === "number" ? b.critic_score : null,
          }))
          .filter((x) => x.critic !== null)
          .sort((a, b) => (b.critic ?? 0) - (a.critic ?? 0))
          .slice(0, 10);
        if (ranked.length > 0) {
          out.push({ type, mode: "fallback", nSameType: 0, items: ranked });
        }
      } else {
        // Personalized: feed engine only the same-type ratings.
        // Engine already enforces same-type scoring; passing same-type rated
        // keeps importance learning focused on this type's signal.
        const recs = recommend(sameTypeRated, candFp).slice(0, 10);
        if (recs.length > 0) {
          out.push({ type, mode: "personalized", nSameType: sameTypeRated.length, items: recs });
        }
      }
    }
    return out;
  }, [ratedBottles, ratings, ratedIds, pool]);

  const nRated = ratings?.length ?? 0;
  const loading = !ratings || (ratedIds.length > 0 && !ratedBottles) || !pool;

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pour these next</p>
      <h1 className="font-serif text-3xl mt-2">Bottles you'd likely love</h1>

      {loading ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading recommendations…</p>
      ) : nRated === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-card/60 p-5">
          <p className="text-sm text-muted-foreground">
            Rate a few bottles to personalize — we'll start with critic favorites below.
          </p>
          <Link to="/rate" className="mt-4 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">
            Go rate
          </Link>
          <div className="mt-8 space-y-10">
            {sections.map((s) => <SectionView key={s.type} section={s} />)}
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-10">
          {sections.length === 0 && (
            <p className="text-sm text-muted-foreground">No unrated bottles in the catalogue yet.</p>
          )}
          {sections.map((s) => <SectionView key={s.type} section={s} />)}
        </div>
      )}
    </div>
  );
}

function SectionView({ section }: { section: Section }) {
  const tag =
    section.mode === "fallback"
      ? "Popular picks — rate some to personalize"
      : section.nSameType < 3
      ? `Still learning — based on ${section.nSameType} rating${section.nSameType === 1 ? "" : "s"}`
      : null;

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl">{TYPE_LABEL[section.type]}</h2>
      </div>
      {tag && <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{tag}</p>}
      <ul className="mt-3 divide-y divide-border">
        {section.mode === "personalized"
          ? section.items.map((r) => (
              <li key={r.bottle.id} className="py-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <WineTypeBadge type={section.type} />
                    <p className="font-medium leading-tight truncate">{r.bottle.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
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
            ))
          : section.items.map((r) => (
              <li key={r.bottle.id} className="py-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-muted-foreground">
                      {TYPE_BADGE[section.type]}
                    </span>
                    <p className="font-medium leading-tight truncate">{r.bottle.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {[r.bottle.producer, r.bottle.region].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {r.critic !== null && (
                  <div className="shrink-0 text-right">
                    <span className="font-serif text-muted-foreground text-base">{r.critic.toFixed(0)}</span>
                    <span className="text-muted-foreground text-xs"> critic</span>
                  </div>
                )}
              </li>
            ))}
      </ul>
    </section>
  );
}
