import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import { ListControls } from "@/components/ListControls";
import { DrinkingGroupSelector } from "@/components/DrinkingGroupSelector";
import { useAllBottlesPaged, useBottlesByIds, useRatings, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { useGroupSelection, useGroupPredict, type GroupCandidateInput } from "@/hooks/use-friends";
import { recommend, type BottleFp, type RatedFp, type Recommendation, type WineType } from "@/lib/recommender";
import { aggregateRated, aggregateCandidates, cuveeKey, type CuveeCandidate, type CuveeRated } from "@/lib/cuvee";
import { applyControls, normalizePrice, isGreatValue, DEFAULT_CONTROLS, type Controls, type Priced } from "@/lib/list-controls";
import type { GroupScored } from "@/lib/group.functions";

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

type RankedCuvee = Recommendation & { cuvee: CuveeCandidate; nearestCuvee: CuveeRated | null };

type Section =
  | { type: WineType; mode: "personalized"; nSameType: number; items: RankedCuvee[] }
  | { type: WineType; mode: "fallback"; nSameType: 0; items: CuveeCandidate[] };

function vintageLabel(vs: number[]): string | null {
  if (vs.length === 0) return null;
  if (vs.length === 1) return `${vs[0]}`;
  if (vs.length <= 3) return vs.join(", ");
  return `${vs[0]}–${vs[vs.length - 1]} (${vs.length} vintages)`;
}

function Pour() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const { data: pool } = useAllBottlesPaged();

  const sections: Section[] = useMemo(() => {
    if (!ratings || !pool) return [];

    // 1. Aggregate the user's ratings to the cuvée level.
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
    const ratedCuveeByKey = new Map(ratedCuvees.map((c) => [c.cuvee, c]));

    // 2. Group catalog candidates by cuvée, excluding any cuvée the user has already rated.
    const candidatesRaw = pool.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage, fp: bottleToFp(b),
      critic_score: b.critic_score, price_band: b.price_band,
    }));
    const allCuvees = aggregateCandidates(candidatesRaw)
      .filter((c) => !ratedCuveeKeys.has(c.cuvee));

    // 3. Per-type sections. Keep a wider pool per section (up to 60) so
    // filters/sort have something to work with; the view caps to 10.
    const out: Section[] = [];
    for (const type of TYPE_ORDER) {
      const cands = allCuvees.filter((c) => c.type === type);
      if (cands.length === 0) continue;
      const sameTypeRated = ratedCuvees.filter((r) => r.type === type);

      if (sameTypeRated.length === 0) {
        const ranked = [...cands]
          .filter((c) => c.critic_score !== null)
          .sort((a, b) => (b.critic_score ?? 0) - (a.critic_score ?? 0))
          .slice(0, 60);
        if (ranked.length > 0) out.push({ type, mode: "fallback", nSameType: 0, items: ranked });
      } else {
        // Feed the recommender cuvée-aggregated rated rows and candidate cuvées.
        const ratedFp: RatedFp[] = sameTypeRated.map((r) => ({
          id: r.id, name: r.name, producer: r.producer, region: r.region,
          type: r.type, fp: r.fp, stars: r.stars,
        }));
        const candFp: BottleFp[] = cands.map((c) => ({
          id: c.id, name: c.name, producer: c.producer, region: c.region,
          type: c.type, fp: c.fp,
        }));
        const recs = recommend(ratedFp, candFp).slice(0, 60);
        const candByRepId = new Map(cands.map((c) => [c.id, c]));
        const ratedByRepId = new Map(sameTypeRated.map((r) => [r.id, r]));
        const items: RankedCuvee[] = recs
          .map((r) => {
            const cuvee = candByRepId.get(r.bottle.id);
            if (!cuvee) return null;
            const nearestCuvee = r.nearest ? ratedByRepId.get(r.nearest.id) ?? null : null;
            return { ...r, cuvee, nearestCuvee };
          })
          .filter((x): x is RankedCuvee => x !== null);
        if (items.length > 0) out.push({ type, mode: "personalized", nSameType: sameTypeRated.length, items });
      }
    }
    // Suppress unused var warning for cuveeKey/ratedCuveeByKey (kept for future debug).
    void cuveeKey; void ratedCuveeByKey;
    return out;
  }, [ratedBottles, ratings, pool]);

  const nRated = ratings?.length ?? 0;
  const loading = !ratings || (ratedIds.length > 0 && !ratedBottles) || !pool;

  // --- Group mode ---
  const group = useGroupSelection();
  const groupCandidates: GroupCandidateInput[] = useMemo(() => {
    if (group.friendIds.length === 0) return [];
    const seen = new Set<string>();
    const out: GroupCandidateInput[] = [];
    for (const s of sections) {
      const cs = s.mode === "personalized" ? s.items.map((r) => r.cuvee) : s.items;
      for (const c of cs) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push({ id: c.id, name: c.name, producer: c.producer, region: c.region, type: c.type, fp: c.fp });
      }
    }
    return out;
  }, [sections, group.friendIds]);
  const groupPred = useGroupPredict(group.friendIds, groupCandidates);
  const groupScores = groupPred.data ?? null;

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pour these next</p>
      <h1 className="font-serif text-3xl mt-2">Bottles you'd likely love</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Vintages of the same wine are grouped — we match on style, not year.
      </p>

      <div className="mt-4">
        <DrinkingGroupSelector
          selectedIds={group.friendIds}
          onToggle={group.toggle}
          onClear={group.clear}
          onSet={group.set}
        />
      </div>

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
            {sections.map((s) => <SectionView key={s.type} section={s} groupScores={groupScores} groupActive={group.friendIds.length > 0} groupLoading={groupPred.isFetching} />)}
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-10">
          {sections.length === 0 && (
            <p className="text-sm text-muted-foreground">No unrated bottles in the catalogue yet.</p>
          )}
          {sections.map((s) => <SectionView key={s.type} section={s} groupScores={groupScores} groupActive={group.friendIds.length > 0} groupLoading={groupPred.isFetching} />)}
        </div>
      )}
    </div>
  );
}

function CuveeMeta({ producer, region, vintages }: { producer: string | null; region: string | null; vintages: number[] }) {
  const meta = [producer, region].filter(Boolean).join(" · ");
  const vl = vintageLabel(vintages);
  return (
    <p className="text-xs text-muted-foreground truncate mt-0.5">
      {meta}{vl ? <span className="text-muted-foreground/80"> · {vl}</span> : null}
    </p>
  );
}

type Row = Priced & {
  key: string;
  name: string;
  producer: string | null;
  region: string | null;
  vintages: number[];
  criticScore: number | null;
  nearestCuvee: CuveeRated | null;
  greatValue: boolean;
};

function toRows(section: Section): Row[] {
  if (section.mode === "personalized") {
    return section.items.map((r) => {
      const p = normalizePrice(r.cuvee.price_band);
      const row: Row = {
        key: r.cuvee.cuvee,
        name: r.cuvee.name,
        producer: r.cuvee.producer,
        region: r.cuvee.region,
        vintages: r.cuvee.vintages,
        criticScore: r.cuvee.critic_score,
        nearestCuvee: r.nearestCuvee,
        price_amount: p.amount,
        price_band: p.band,
        price_display: p.display,
        isCatalog: true, // /pour candidates are all catalog wines
        predicted: r.predicted,
        greatValue: false,
      };
      row.greatValue = isGreatValue(row);
      return row;
    });
  }
  return section.items.map((c) => {
    const p = normalizePrice(c.price_band);
    return {
      key: c.cuvee,
      name: c.name,
      producer: c.producer,
      region: c.region,
      vintages: c.vintages,
      criticScore: c.critic_score,
      nearestCuvee: null,
      price_amount: p.amount,
      price_band: p.band,
      price_display: p.display,
      isCatalog: true,
      predicted: 0,
      greatValue: false,
    };
  });
}

function SectionView({ section }: { section: Section }) {
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  const isFallback = section.mode === "fallback";
  const tag = isFallback
    ? "Popular picks — rate some to personalize"
    : section.nSameType < 3
    ? `Still learning — based on ${section.nSameType} cuvée${section.nSameType === 1 ? "" : "s"} you've rated`
    : null;

  const rows = useMemo(() => toRows(section), [section]);
  // In fallback mode "best match" / "best value" / "confident" all mean nothing
  // (no predicted stars, everything is catalog). Force best-of-critic ordering
  // when the user picks those, but honour price sorts and price filter.
  const effective: Controls = isFallback && (controls.sort === "best" || controls.sort === "value" || controls.sort === "confident")
    ? { ...controls, sort: "best" }
    : controls;
  const filtered = useMemo(() => {
    const out = applyControls(rows, effective);
    // For fallback, keep the critic-score order when sort is "best".
    if (isFallback && effective.sort === "best") {
      return [...out].sort((a, b) => (b.criticScore ?? 0) - (a.criticScore ?? 0));
    }
    return out;
  }, [rows, effective, isFallback]);
  const visible = filtered.slice(0, 10);
  const hidden = Math.max(0, filtered.length - visible.length);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl">{TYPE_LABEL[section.type]}</h2>
      </div>
      {tag && <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{tag}</p>}
      <ListControls value={controls} onChange={setControls} idPrefix={`pour-${section.type}`} />
      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No wines in this section match those filters. Widen the price range or turn off "catalog only".
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {visible.map((r) => (
            <li key={r.key} className="py-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <WineTypeBadge type={section.type} />
                  <p className="font-medium leading-tight truncate">{r.name}</p>
                  <span className="shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-primary/40 bg-primary/10 text-primary">
                    catalog
                  </span>
                  {r.greatValue && (
                    <span className="shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                      great value
                    </span>
                  )}
                </div>
                <CuveeMeta producer={r.producer} region={r.region} vintages={r.vintages} />
                {r.price_display && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Price: {r.price_display}</p>
                )}
                {r.nearestCuvee && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    like your {r.nearestCuvee.stars.toFixed(1)}★ <span className="text-foreground/80">{r.nearestCuvee.name}</span>
                  </p>
                )}
              </div>
              <div className="shrink-0 text-right">
                {isFallback ? (
                  r.criticScore !== null && (
                    <>
                      <span className="font-serif text-muted-foreground text-base">{r.criticScore.toFixed(0)}</span>
                      <span className="text-muted-foreground text-xs"> critic</span>
                    </>
                  )
                ) : (
                  <>
                    <span className="font-serif text-primary text-xl">{r.predicted.toFixed(1)}</span>
                    <span className="text-primary text-sm">★</span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">+{hidden} more match these filters.</p>
      )}
    </section>
  );
}
