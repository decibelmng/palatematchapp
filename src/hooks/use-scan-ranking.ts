import { useMemo } from "react";
import { useBottlesByIds, bottleToFp, bottleType, useRatings } from "@/hooks/use-palate-data";
import { useMyCanons } from "@/hooks/use-canon";
import { recommend, type BottleFp, type RatedFp, type Recommendation, type WineType } from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";
import { normalizePrice, isGreatValue } from "@/lib/list-controls";
import { computeCellarMemory } from "@/lib/cellar-memory";
import { priceVerdict } from "@/lib/price-verdict";
import { useGroupSelection, useGroupPredict, type GroupCandidateInput } from "@/hooks/use-friends";
import type { ScanRow, Ranked } from "@/components/verdict";
import type { ResolvedWine } from "@/lib/scan.functions";

const MIN_PER_TYPE = 8;

export function useScanRanking(wines: ResolvedWine[]) {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const { data: myCanons } = useMyCanons();

  const dedupWines = useMemo(() => {
    const key = (w: ResolvedWine) =>
      [w.producer, w.wine_name, w.vintage ?? ""].map((s) => String(s ?? "").toLowerCase().trim()).join("|");
    const seen = new Set<string>();
    const out: ResolvedWine[] = [];
    for (const w of wines) { const k = key(w); if (seen.has(k)) continue; seen.add(k); out.push(w); }
    return out;
  }, [wines]);

  const readable = useMemo(() => dedupWines.filter((w) => w.fp_resolved), [dedupWines]);
  const unreadable = useMemo(() => dedupWines.filter((w) => !w.fp_resolved), [dedupWines]);

  const ratedRows: RatedFp[] = useMemo(() => {
    if (!ratedBottles || !ratings) return [];
    const raw = ratedBottles.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage, fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
    }));
    return aggregateRated(raw).map((c) => ({
      id: c.id, name: c.name, producer: c.producer, region: c.region,
      type: c.type, fp: c.fp, stars: c.stars,
    }));
  }, [ratedBottles, ratings]);

  const cellar = useMemo(() => computeCellarMemory({
    readable, ratedBottles: ratedBottles ?? [], ratings: ratings ?? [], canons: myCanons ?? [],
  }), [readable, ratedBottles, ratings, myCanons]);

  const ranked: Ranked[] = useMemo(() => {
    if (readable.length === 0) return [];
    const candidates: BottleFp[] = readable.map((w, i) => ({
      id: `scan-${i}`,
      name: [w.producer, w.wine_name, w.vintage].filter(Boolean).join(" ") || "Unknown wine",
      producer: w.producer ?? null, region: w.region ?? null,
      type: (w.type ?? "red") as WineType, fp: w.fp_resolved!,
    }));
    if (ratedRows.length === 0) {
      return candidates.map((b, i) => ({
        bottle: b, predicted: 0, nearest: null, nearestIsCanon: false, maxSimilarity: 0, confidence: 0,
        evidence: 0, evidenceTier: "exploratory" as const, vetoed: false, vetoReason: null,
        contested: false, contestedReason: null, scanned: readable[i],
      }));
    }
    const recs = recommend(ratedRows, candidates);
    const byId = new Map(readable.map((w, i) => [`scan-${i}`, w]));
    return recs.map((r) => ({ ...r, scanned: byId.get(r.bottle.id)! }));
  }, [readable, ratedRows]);

  const predictionsByIndex = useMemo(() => {
    const m = new Map<number, Recommendation>();
    for (const r of ranked) {
      const idx = Number(r.bottle.id.replace("scan-", ""));
      if (!Number.isNaN(idx)) m.set(idx, r);
    }
    return m;
  }, [ranked]);

  const matchedBottleIds = useMemo(
    () => readable.map((w) => w.matched_bottle_id).filter((id): id is string => !!id),
    [readable],
  );
  const { data: matchedBottleRows } = useBottlesByIds(matchedBottleIds);
  const priceBandByBottleId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const b of matchedBottleRows ?? []) m.set(b.id, b.price_band);
    return m;
  }, [matchedBottleRows]);

  // Group overlay
  const group = useGroupSelection();
  const groupCandidates: GroupCandidateInput[] = useMemo(() => {
    if (group.friendIds.length === 0) return [];
    return ranked.map((r) => ({
      id: r.bottle.id, name: r.bottle.name,
      producer: r.bottle.producer ?? null, region: r.bottle.region ?? null,
      type: r.bottle.type, fp: r.bottle.fp,
    }));
  }, [ranked, group.friendIds]);
  const groupPred = useGroupPredict(group.friendIds, groupCandidates);
  const groupScores = groupPred.data ?? null;
  const groupActive = group.friendIds.length > 0;

  const allRowsFlat: ScanRow[] = useMemo(() => {
    const rows: ScanRow[] = [];
    ranked.forEach((r, i) => {
      const idx = Number(r.bottle.id.replace("scan-", ""));
      if (cellar.byIndex.has(idx)) return;
      const t = (r.scanned.type ?? "red") as WineType;
      const p = normalizePrice(r.scanned.price ?? null);
      const matchedId = r.scanned.matched_bottle_id;
      const band = matchedId ? priceBandByBottleId.get(matchedId) ?? null : null;
      const row: ScanRow = {
        key: r.bottle.id + "-" + i,
        ranked: r, type: t,
        isCatalog: r.scanned.fp_source === "catalog",
        price_amount: p.amount, price_band: p.band, price_display: p.display,
        predicted: r.predicted, greatValue: false,
        verdict: priceVerdict(p.amount, band),
      };
      row.greatValue = isGreatValue(row);
      rows.push(row);
    });
    if (!groupActive || !groupScores) return rows;
    return rows.map((r) => {
      const g = groupScores.get(r.ranked.bottle.id);
      if (!g) return r;
      const next: ScanRow = { ...r, predicted: g.group_min };
      next.greatValue = isGreatValue(next);
      return next;
    });
  }, [ranked, cellar, priceBandByBottleId, groupActive, groupScores]);

  const enoughRatings = ratedRows.length >= 3;

  const perTypeRated = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ratedRows) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return m;
  }, [ratedRows]);
  const lowConfTypes = useMemo(() => {
    const scanned = new Set(readable.map((w) => (w.type ?? "red") as string));
    const low: string[] = [];
    for (const t of scanned) if ((perTypeRated.get(t) ?? 0) < MIN_PER_TYPE) low.push(t);
    return low;
  }, [readable, perTypeRated]);

  const matchedCount = dedupWines.filter((w) => w.fp_source === "catalog").length;
  const estimatedCount = dedupWines.filter((w) => w.fp_source === "estimated").length;

  return {
    dedupWines, readable, unreadable, matchedCount, estimatedCount,
    ratedRows, enoughRatings, lowConfTypes, perTypeRated, MIN_PER_TYPE,
    ranked, predictionsByIndex, cellar,
    group, allRowsFlat,
  };
}
