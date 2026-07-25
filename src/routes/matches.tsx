import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { FingerprintSpoke } from "@/components/FingerprintSpoke";
import { AuthGate } from "@/components/AuthGate";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import { ListControls } from "@/components/ListControls";
import { DrinkingGroupSelector } from "@/components/DrinkingGroupSelector";
import { usePourCandidates, useBottlesByIds, useRatings, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { useMyCanons } from "@/hooks/use-canon";
import { useGroupSelection, useGroupPredict, type GroupCandidateInput } from "@/hooks/use-friends";
import { recommend, CANON_WEIGHT, BENCHMARK_WEIGHT, type BottleFp, type RatedFp, type Recommendation, type WineType } from "@/lib/recommender";
import { aggregateRated, aggregateCandidates, cuveeKey, type CuveeCandidate, type CuveeRated } from "@/lib/cuvee";
import { applyControls, normalizePrice, isGreatValue, DEFAULT_CONTROLS, type Controls, type Priced } from "@/lib/list-controls";
import type { GroupScored } from "@/lib/group.functions";
import { CanonBadge } from "@/components/CanonBadge";
import { LaneList } from "@/components/LaneList";
import { buildLanes, applyGlobalCap, type LaneItem } from "@/lib/lanes";
import { useMatchesLayout, type MatchesLayout } from "@/hooks/use-layout-pref";

export const Route = createFileRoute("/matches")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Matches — Palate Match" },
      { name: "description", content: "Bottles that match your palate — vintages of the same wine are grouped." },
    ],
  }),
  component: () => <AuthGate><Matches /></AuthGate>,
});

const TYPE_ORDER: WineType[] = ["red", "white", "sparkling", "rose", "dessert"];
const TYPE_LABEL: Record<WineType, string> = {
  red: "Reds for you",
  white: "Whites for you",
  sparkling: "Sparkling for you",
  rose: "Rosés for you",
  dessert: "Dessert wines for you",
};

type RankedCuvee = Recommendation & { cuvee: CuveeCandidate; nearestCuvee: CuveeRated | null; nearestIsCanon: boolean };

type Section =
  | { type: WineType; mode: "personalized"; nSameType: number; items: RankedCuvee[]; ratedFp: RatedFp[] }
  | { type: WineType; mode: "fallback"; nSameType: 0; items: CuveeCandidate[]; ratedFp: null };

function vintageLabel(vs: number[]): string | null {
  if (vs.length === 0) return null;
  if (vs.length === 1) return `${vs[0]}`;
  if (vs.length <= 3) return vs.join(", ");
  return `${vs[0]}–${vs[vs.length - 1]} (${vs.length} vintages)`;
}

function Matches() {
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
  const canonRegionByBottle = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of canons ?? []) {
      if (c.tier === "canon") m.set(c.bottle_id, c.region);
    }
    return m;
  }, [canons]);


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
      raw: b.raw ?? false,
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
        if (ranked.length > 0) out.push({ type, mode: "fallback", nSameType: 0, items: ranked, ratedFp: null });
      } else {
        // Feed the recommender cuvée-aggregated rated rows and candidate cuvées.
        // Cuvées that contain a Canon bottle carry CANON_WEIGHT + canon flag so
        // their similarity mass dominates the kernel sum and "nearest" surfaces
        // the Canon anchor in the reason line.
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
            // Raw (uncalibrated) cuvées: their fingerprint is a template, so
            // the predicted score AND the veto distance are both unreliable.
            // Clear veto on raw (we can't trust either direction) and route
            // them into a separate "Uncalibrated" section that has NO star
            // prediction. Calibrated wines keep their engine score and veto.
            if (cuvee.raw) {
              return { ...r, cuvee, nearestCuvee, nearestIsCanon: r.nearestIsCanon, vetoed: false, vetoReason: null, contested: false, contestedReason: null };
            }
            return { ...r, cuvee, nearestCuvee, nearestIsCanon: r.nearestIsCanon };
          })
          .filter((x): x is RankedCuvee => x !== null)
          // Preserve engine sort (vetoed sink to bottom, else predicted desc).
          .sort((a, b) => {
            if (a.vetoed !== b.vetoed) return a.vetoed ? 1 : -1;
            return b.predicted - a.predicted;
          });
        if (items.length > 0) out.push({ type, mode: "personalized", nSameType: sameTypeRated.length, items, ratedFp });
      }
    }
    // Suppress unused var warning for cuveeKey/ratedCuveeByKey (kept for future debug).
    void cuveeKey; void ratedCuveeByKey;

    return out;
  }, [ratedBottles, ratings, pool, canonBottleIds, nemesisBottleIds]);


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

  const [layout, setLayout] = useMatchesLayout();

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Matches</p>
      <h1 className="font-serif text-3xl mt-2">Matches</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Bottles that match your palate — vintages of the same wine are grouped.
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
        <DrinkingGroupSelector
          selectedIds={group.friendIds}
          onToggle={group.toggle}
          onClear={group.clear}
          onSet={group.set}
        />
        <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 p-0.5 text-[10px] uppercase tracking-wider">
          <button
            type="button"
            onClick={() => setLayout("lanes")}
            aria-pressed={layout === "lanes"}
            className={`rounded-full px-2.5 py-1 transition ${layout === "lanes" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Lanes
          </button>
          <button
            type="button"
            onClick={() => setLayout("flat")}
            aria-pressed={layout === "flat"}
            className={`rounded-full px-2.5 py-1 transition ${layout === "flat" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            Flat list
          </button>
        </div>
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
            {sections.map((s) => <SectionView key={s.type} section={s} groupScores={groupScores} groupActive={group.friendIds.length > 0} groupLoading={groupPred.isFetching} canonRegionByBottle={canonRegionByBottle} layout={layout} />)}
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-10">
          {sections.length === 0 && (
            <p className="text-sm text-muted-foreground">No unrated bottles in the catalogue yet.</p>
          )}
          {sections.map((s) => <SectionView key={s.type} section={s} groupScores={groupScores} groupActive={group.friendIds.length > 0} groupLoading={groupPred.isFetching} canonRegionByBottle={canonRegionByBottle} layout={layout} />)}
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
  id: string;              // representative bottle id (used to look up group scores)
  name: string;
  producer: string | null;
  region: string | null;
  vintages: number[];
  criticScore: number | null;
  nearestCuvee: CuveeRated | null;
  nearestIsCanon: boolean;
  nearestCanonRegion: string | null;
  greatValue: boolean;
  confidence: number | null;
  raw: boolean;            // uncalibrated (import-defaults) cuvée — hide from top 10
  vetoed: boolean;
  vetoNemesisName: string | null;
  vetoAxes: string[];
  contested: boolean;
  contestedNemesisName: string | null;
  maxSimilarity?: number;
  nearestId: string | null;
  fp: BottleFp["fp"];
};


function toRows(section: Section, canonRegionByBottle: Map<string, string>): Row[] {
  if (section.mode === "personalized") {
    return section.items.map((r) => {
      const p = normalizePrice(r.cuvee.price_band);
      const canonRegion = r.nearestIsCanon && r.nearestCuvee
        ? r.nearestCuvee.bottleIds.map((id) => canonRegionByBottle.get(id)).find(Boolean) ?? r.nearestCuvee.region ?? null
        : null;
      const row: Row = {
        key: r.cuvee.cuvee,
        id: r.cuvee.id,
        name: r.cuvee.name,
        producer: r.cuvee.producer,
        region: r.cuvee.region,
        vintages: r.cuvee.vintages,
        criticScore: r.cuvee.critic_score,
        nearestCuvee: r.nearestCuvee,
        nearestIsCanon: r.nearestIsCanon,
        nearestCanonRegion: canonRegion,
        price_amount: p.amount,
        price_band: p.band,
        price_display: p.display,
        isCatalog: true, // /pour candidates are all catalog wines
        predicted: r.predicted,
        greatValue: false,
        confidence: r.confidence,
        raw: r.cuvee.raw,
        vetoed: r.vetoed,
        vetoNemesisName: r.vetoReason?.nemesis.name ?? null,
        vetoAxes: r.vetoReason?.drivingAxes ?? [],
        contested: r.contested,
        contestedNemesisName: r.contestedReason?.nemesis.name ?? null,
        maxSimilarity: r.maxSimilarity,
        nearestId: r.nearest?.id ?? null,
        fp: r.cuvee.fp,
      };
      row.greatValue = !row.vetoed && isGreatValue(row);
      return row;
    });
  }

  return section.items.map((c) => {
    const p = normalizePrice(c.price_band);
    return {
      key: c.cuvee,
      id: c.id,
      name: c.name,
      producer: c.producer,
      region: c.region,
      vintages: c.vintages,
      criticScore: c.critic_score,
      nearestCuvee: null,
      nearestIsCanon: false,
      nearestCanonRegion: null,
      price_amount: p.amount,
      price_band: p.band,
      price_display: p.display,
      isCatalog: true,
      predicted: 0,
      greatValue: false,
      confidence: null,
      raw: c.raw,
      vetoed: false,
      vetoNemesisName: null,
      vetoAxes: [],
      contested: false,
      contestedNemesisName: null,
      nearestId: null,
      fp: c.fp,
    };
  });
}


type SectionViewProps = {
  section: Section;
  groupScores: Map<string, GroupScored> | null;
  groupActive: boolean;
  groupLoading: boolean;
  canonRegionByBottle: Map<string, string>;
  layout: MatchesLayout;
};

function SectionView({ section, groupScores, groupActive, groupLoading, canonRegionByBottle, layout }: SectionViewProps) {
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  const isFallback = section.mode === "fallback";
  const tag = isFallback
    ? "Popular picks — rate some to personalize"
    : section.nSameType < 3
    ? `Still learning — based on ${section.nSameType} cuvée${section.nSameType === 1 ? "" : "s"} you've rated`
    : null;

  const baseRows = useMemo(() => toRows(section, canonRegionByBottle), [section, canonRegionByBottle]);
  // In group mode, replace `predicted` with the server-computed group_min so
  // the standard "best" / "value" sort and greatValue tag work unchanged.
  const rows: Row[] = useMemo(() => {
    if (!groupActive || !groupScores) return baseRows;
    return baseRows.map((r) => {
      const g = groupScores.get(r.id);
      if (!g) return r;
      const withGroup: Row = { ...r, predicted: g.group_min };
      withGroup.greatValue = isGreatValue(withGroup);
      return withGroup;
    });
  }, [baseRows, groupActive, groupScores]);

  // In fallback mode "best match" / "best value" / "confident" all mean nothing
  // (no predicted stars, everything is catalog). Force best-of-critic ordering
  // when the user picks those, but honour price sorts and price filter.
  // In group mode we always have a predicted score, so treat like personalized.
  const treatAsFallback = isFallback && !groupActive;
  const effective: Controls = treatAsFallback && (controls.sort === "best" || controls.sort === "value" || controls.sort === "confident")
    ? { ...controls, sort: "best" }
    : controls;
  const filtered = useMemo(() => {
    const out = applyControls(rows, effective);
    if (treatAsFallback && effective.sort === "best") {
      return [...out].sort((a, b) => (b.criticScore ?? 0) - (a.criticScore ?? 0));
    }
    return out;
  }, [rows, effective, treatAsFallback]);
  // Split: calibrated wines rank normally (top 10 by predicted, vetoed → Avoid).
  // Raw (uncalibrated / template-fingerprint) wines are NEVER ranked by predicted
  // score — the template coordinates make predicted and M unreliable, so we hide
  // the star and collapse them into a separate "Uncalibrated" section below the
  // ranked list. Raw is also exempt from Nemesis veto (distance is unreliable
  // in both directions), so no raw wine appears in Avoid either.
  const calibrated = filtered.filter((r) => !r.raw);
  const rawItems = filtered.filter((r) => r.raw);
  const visible = calibrated.filter((r) => !r.vetoed).slice(0, 10);
  const vetoed = calibrated.filter((r) => r.vetoed);
  const hidden = Math.max(0, calibrated.length - visible.length - vetoed.length);
  const [showRaw, setShowRaw] = useState(false);

  // ── Lane clustering (presentation-only) ──
  // Lanes require: personalized mode, layout preference = "lanes", section
  // has Canons for this type, and we're not in group mode (group keeps the
  // flat maximin list).
  const laneEligible =
    section.mode === "personalized" &&
    layout === "lanes" &&
    !groupActive &&
    section.ratedFp.some((r) => r.canon);
  const laneItems = useMemo<LaneItem<Row>[]>(() => {
    if (!laneEligible) return [];
    return calibrated.map((r) => ({
      predicted: r.predicted,
      maxSimilarity: r.maxSimilarity ?? 0,
      nearestId: r.nearestId,
      vetoed: r.vetoed,
      raw: r.raw,
      payload: r,
    }));
  }, [laneEligible, calibrated]);
  const laneResult = useMemo(() => {
    if (!laneEligible || section.mode !== "personalized") return null;
    const res = buildLanes(laneItems, section.ratedFp, section.type);
    if (!res.hasCanons) return null;
    return { ...res, lanes: applyGlobalCap(res.lanes, 8, 15) };
  }, [laneEligible, laneItems, section]);
  const useLanes = !!laneResult && laneResult.lanes.length > 0;
  const lanes = laneResult?.lanes ?? [];

  // Row → detail sheet
  const [openRow, setOpenRow] = useState<Row | null>(null);

  // Phase 2 acceptance logging (dev only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
    if (!dev) return;
    const cards = [...visible, ...vetoed];
    const badgeCounts = cards.map((r) => {
      let n = 0;
      if (r.vetoed) n += 1; // AVOID pill
      if (r.greatValue && !r.vetoed) n += 1; // value dot (counted as a flag)
      // contested is a left-edge stripe, not a chip — not counted
      return n;
    });
    const reasons = cards.slice(0, 10).map((r) => reasonLine(r));
    // eslint-disable-next-line no-console
    console.groupCollapsed(`[matches:${section.type}] Phase 2 acceptance`);
    console.log("badges per card (max should be 1):", badgeCounts);
    console.log("max badge count:", Math.max(0, ...badgeCounts));
    console.log("reason samples:", reasons);
    console.log("reason word counts:", reasons.map((s) => (s ? s.split(/\s+/).length : 0)));
    console.groupEnd();
  }, [visible, vetoed, section.type]);

  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl">{TYPE_LABEL[section.type]}</h2>
      </div>
      {tag && !groupActive && (
        <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">{tag}</p>
      )}
      {groupActive && (
        <p className="mt-1 text-[11px] uppercase tracking-wider text-primary">
          Group picks · ranked by worst-case ★{groupLoading ? " · scoring…" : ""}
        </p>
      )}
      <ListControls value={controls} onChange={setControls} idPrefix={`matches-${section.type}`} />
      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No wines in this section match those filters. Widen the price range or turn off "catalog only".
        </p>
      ) : useLanes ? (
        <LaneList
          lanes={lanes}
          keyFor={(r: Row) => r.key}
          renderRow={(r: Row) => (
            <MatchRow
              r={r}
              g={groupActive && groupScores ? groupScores.get(r.id) ?? null : null}
              showFallbackScore={treatAsFallback && !(groupActive && groupScores?.get(r.id))}
              onOpen={() => setOpenRow(r)}
            />
          )}
        />
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {visible.map((r) => {
            const g = groupActive && groupScores ? groupScores.get(r.id) ?? null : null;
            const showFallbackScore = treatAsFallback && !g;
            return (
              <li key={r.key}>
                <MatchRow r={r} g={g} showFallbackScore={showFallbackScore} onOpen={() => setOpenRow(r)} />
              </li>
            );
          })}
        </ul>
      )}
      {vetoed.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-destructive">Avoid ✕</span>
            <span className="text-[11px] text-muted-foreground">
              {vetoed.length} bottle{vetoed.length === 1 ? "" : "s"} inside a Nemesis radius
            </span>
          </div>
          <ul className="mt-2 divide-y divide-border/60">
            {vetoed.map((r) => (
              <li key={r.key}>
                <MatchRow r={r} g={null} showFallbackScore={false} onOpen={() => setOpenRow(r)} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {hidden > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">+{hidden} more match these filters.</p>
      )}

      {rawItems.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground min-h-11"
          >
            {showRaw ? "▾" : "▸"} Uncalibrated ({rawItems.length})
          </button>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Template fingerprint — predicted score suppressed until the LLM calibration pass covers these.
          </p>
          {showRaw && (
            <ul className="mt-2 divide-y divide-border/60">
              {rawItems.slice(0, 25).map((r) => (
                <li key={r.key}>
                  <MatchRow r={r} g={null} showFallbackScore={false} uncalibrated onOpen={() => setOpenRow(r)} />
                </li>
              ))}
              {rawItems.length > 25 && (
                <li className="py-2 text-[11px] text-muted-foreground">+{rawItems.length - 25} more uncalibrated cuvées</li>
              )}
            </ul>
          )}
        </div>
      )}

      <MatchDetailSheet row={openRow} type={section.type} onClose={() => setOpenRow(null)} />
    </section>
  );
}

function GroupBreakdown({ g }: { g: GroupScored }) {
  return (
    <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
      {g.per_person.map((p, i) => (
        <span key={p.user_id}>
          {i > 0 && <span className="opacity-50"> · </span>}
          <span className="text-foreground/80">{p.display_name}</span>{" "}
          {p.predicted.toFixed(1)}
          {p.still_learning && <span className="ml-0.5 opacity-70">(still learning)</span>}
        </span>
      ))}
    </p>
  );
}

// ── Reason line: ≤6 words, no raw appellation dumps ──────────────────
function shortAnchor(producer: string | null, name: string | null): string {
  const src = (producer || name || "").replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (!src) return "";
  const words = src.split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ");
}
function reasonLine(r: Row): string | null {
  if (!r.nearestCuvee) return null;
  const anchor = shortAnchor(r.nearestCuvee.producer, r.nearestCuvee.name);
  if (!anchor) return null;
  if (r.nearestIsCanon) return `like your Canon ${anchor}`;
  return `like your ${r.nearestCuvee.stars.toFixed(1)}★ ${anchor}`;
}

// ── Match card (new anatomy) ─────────────────────────────────────────
function MatchRow({
  r,
  g,
  showFallbackScore,
  uncalibrated,
  onOpen,
}: {
  r: Row;
  g: GroupScored | null;
  showFallbackScore: boolean;
  uncalibrated?: boolean;
  onOpen: () => void;
}) {
  const score: string | null = uncalibrated
    ? null
    : g
    ? g.group_min.toFixed(1)
    : showFallbackScore
    ? r.criticScore !== null
      ? r.criticScore.toFixed(0)
      : null
    : r.predicted.toFixed(1)
  ;
  const scoreIsCritic = !uncalibrated && !g && showFallbackScore;
  const strengthWord = !uncalibrated && !g && !showFallbackScore && typeof r.maxSimilarity === "number"
    ? r.maxSimilarity >= 0.85 ? "strong"
    : r.maxSimilarity >= 0.65 ? "close"
    : r.maxSimilarity >= 0.45 ? "loose"
    : "distant"
    : null;

  const edge = r.vetoed
    ? "before:absolute before:inset-y-0 before:left-0 before:w-1.5 before:bg-destructive"
    : r.contested
    ? "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-amber-500/80"
    : "";
  const reason = uncalibrated ? null : reasonLine(r);
  const producerLine = [r.producer, r.region].filter(Boolean).join(" · ")
    + (r.vintages.length > 0 ? " · " + (vintageLabel(r.vintages) ?? "") : "");

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Details for ${r.name}`}
      className={`relative w-full text-left py-4 pl-4 pr-3 flex items-start gap-4 min-h-11 hover:bg-accent/40 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${edge}`}
    >
      {/* Score chip — LEFT, hero */}
      <div className="shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-xl border border-border bg-[--surface-2] text-center">
        {score ? (
          <>
            <span className={`font-serif leading-none ${scoreIsCritic ? "text-muted-foreground text-lg" : "text-primary text-[22px]"}`}>{score}</span>
            <span className={`mt-0.5 leading-none ${scoreIsCritic ? "text-[9px] uppercase tracking-wider text-muted-foreground" : "text-primary text-sm"}`}>
              {scoreIsCritic ? "critic" : "★"}
            </span>
            {strengthWord && (
              <span className="mt-0.5 text-[8px] uppercase tracking-wider text-muted-foreground leading-none">{strengthWord}</span>
            )}
          </>
        ) : (
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">n/a</span>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p
          className={`font-medium text-[15px] leading-snug break-words ${r.vetoed ? "text-muted-foreground line-through decoration-destructive/60" : "text-foreground"}`}
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        >
          {r.name}
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground truncate">{producerLine}</p>
        <div className="mt-1 flex items-center gap-2 text-[12px]">
          {r.price_display && <span className="text-foreground/80">{r.price_display}</span>}
          {r.greatValue && !r.vetoed && (
            <span className="inline-flex items-center gap-1 text-[--color-value] text-[11px]" title="Great value">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              great value
            </span>
          )}
          {r.vetoed && (
            <span className="inline-flex items-center rounded-full bg-destructive text-destructive-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
              Avoid
            </span>
          )}
        </div>
        {reason && !r.vetoed && (
          <p className="mt-1 text-[12px] text-muted-foreground">{reason}</p>
        )}
        {r.vetoed && r.vetoNemesisName && (
          <p className="mt-1 text-[12px] text-destructive">near your Nemesis {shortAnchor(null, r.vetoNemesisName)}</p>
        )}
        {g && <GroupBreakdown g={g} />}
      </div>
    </button>
  );
}

// ── Detail bottom sheet ──────────────────────────────────────────────
function MatchDetailSheet({
  row,
  type,
  onClose,
}: {
  row: Row | null;
  type: WineType;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!row) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [row, onClose]);
  if (!row) return null;
  const scorePct = typeof row.maxSimilarity === "number"
    ? `${(row.maxSimilarity * 100).toFixed(0)}%`
    : null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={row.name}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden />
        <div className="flex items-start justify-between px-5 pt-3 pb-2 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <WineTypeBadge type={type} />
              {row.vetoed && (
                <span className="inline-flex items-center rounded-full bg-destructive text-destructive-foreground px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                  Avoid
                </span>
              )}
              {!row.vetoed && row.contested && (
                <span className="inline-flex items-center rounded-full border border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-2 py-0.5 text-[10px] uppercase tracking-wider">
                  Contested
                </span>
              )}
            </div>
            <h3 className="mt-2 font-serif text-xl leading-snug">{row.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {[row.producer, row.region].filter(Boolean).join(" · ")}
              {row.vintages.length > 0 ? ` · ${vintageLabel(row.vintages)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="min-h-11 min-w-11 -mr-2 rounded-md text-muted-foreground hover:text-foreground"
          >✕</button>
        </div>

        <div className="px-5 py-3 grid grid-cols-2 gap-4 border-t border-border">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Predicted</p>
            <p className="mt-1 font-serif text-2xl text-primary">
              {row.predicted > 0 ? `${row.predicted.toFixed(1)}★` : "—"}
            </p>
            {scorePct && (
              <p className="text-[11px] text-muted-foreground">Similarity {scorePct}</p>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Price</p>
            <p className="mt-1 text-lg">{row.price_display ?? "—"}</p>
            {row.criticScore !== null && (
              <p className="text-[11px] text-muted-foreground">Critic {row.criticScore.toFixed(0)}</p>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Fingerprint</p>
          <div className="mt-2 flex items-center gap-4">
            <FingerprintSpoke fp={row.fp} size={96} />
            <div className="text-[12px] text-muted-foreground">
              8-axis style read. Bigger polygon = more of that trait.
            </div>
          </div>
        </div>

        {row.nearestCuvee && (
          <div className="px-5 py-3 border-t border-border">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Nearest anchor</p>
            <div className="mt-2 flex items-start gap-2">
              {row.nearestIsCanon && <CanonBadge size="sm" title="Canon anchor" />}
              <div className="text-sm">
                <p className="text-foreground">{row.nearestCuvee.name}</p>
                <p className="text-xs text-muted-foreground">
                  your {row.nearestCuvee.stars.toFixed(1)}★
                  {row.nearestIsCanon ? " · Canon" : ""}
                  {row.nearestCanonRegion ? ` · ${row.nearestCanonRegion}` : row.nearestCuvee.region ? ` · ${row.nearestCuvee.region}` : ""}
                </p>
              </div>
            </div>
          </div>
        )}

        {(row.vetoed || row.contested) && (row.vetoNemesisName || row.contestedNemesisName) && (
          <div className="px-5 py-3 border-t border-border">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Why this flag</p>
            <p className="mt-1 text-sm">
              {row.vetoed
                ? <>Inside <span className="text-destructive font-medium">{row.vetoNemesisName}</span>'s Nemesis radius{row.vetoAxes.length > 0 ? ` — ${row.vetoAxes.join(", ")}` : ""}.</>
                : <>Inside <span className="text-amber-700 dark:text-amber-300">{row.contestedNemesisName}</span>'s reach — but closer to a wine you love.</>
              }
            </p>
          </div>
        )}

        <div className="px-5 pt-3 pb-2 border-t border-border">
          <Link
            to="/wine/$id"
            params={{ id: row.id }}
            className="inline-flex items-center justify-center w-full min-h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
          >
            Open full wine detail →
          </Link>
        </div>
      </div>
    </div>
  );
}
