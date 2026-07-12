// Cellar memory matching: identify scanned wines the user has already rated.
// Tier 1: exact wine_id + vintage — user's rating overrides any prediction.
// Tier 2: same cuvée, different vintage — hybrid (history + this-vintage prediction).
// Tier 3: same producer, different cuvée — chip only, on normal prediction card.

import type { ResolvedWine } from "@/lib/scan.functions";
import type { BottleRow } from "@/hooks/use-palate-data";
import { cuveeKey } from "@/lib/cuvee";
import type { CanonRow } from "@/hooks/use-canon";

export type Tier1Match = {
  tier: 1;
  scannedIndex: number;
  scanned: ResolvedWine;
  bottle: BottleRow;
  stars: number;
  note: string | null;
  isCanon: boolean;
  isNemesis: boolean;
};
export type Tier2Match = {
  tier: 2;
  scannedIndex: number;
  scanned: ResolvedWine;
  /** Representative rated bottle for the cuvée (newest rated vintage). */
  repBottle: BottleRow;
  avgStars: number;
  ratedVintages: number[];
  isCanon: boolean;
  isNemesis: boolean;
};
export type CellarMatch = Tier1Match | Tier2Match;


function normProducer(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export type CellarComputation = {
  matches: CellarMatch[];
  /** scannedIndex -> match; used to filter engine ranking */
  byIndex: Map<number, CellarMatch>;
  /** normalized producers the user has rated, mapped to avg stars + count */
  producers: Map<string, { avg: number; n: number; name: string }>;
};

export function computeCellarMemory(args: {
  readable: ResolvedWine[];
  ratedBottles: BottleRow[];
  ratings: { bottle_id: string; stars: number; note?: string | null }[];
  canons: CanonRow[];
}): CellarComputation {
  const { readable, ratedBottles, ratings, canons } = args;

  const starsById = new Map(ratings.map((r) => [r.bottle_id, r.stars]));
  const noteById = new Map(ratings.map((r) => [r.bottle_id, r.note ?? null]));
  const canonBottleIds = new Set(canons.filter((c) => c.tier === "canon").map((c) => c.bottle_id));
  const nemesisBottleIds = new Set(canons.filter((c) => c.tier === "nemesis").map((c) => c.bottle_id));
  const bottlesById = new Map(ratedBottles.map((b) => [b.id, b]));


  // Aggregate rated bottles by cuvée for Tier 2 lookup.
  type CuveeAgg = { rep: BottleRow; totalStars: number; count: number; vintages: number[]; bottleIds: string[] };
  const byCuvee = new Map<string, CuveeAgg>();
  for (const b of ratedBottles) {
    const stars = starsById.get(b.id);
    if (stars == null) continue;
    const k = cuveeKey({ producer: b.producer, name: b.name, region: b.region, type: b.type });
    const g = byCuvee.get(k);
    if (!g) {
      byCuvee.set(k, {
        rep: b,
        totalStars: stars,
        count: 1,
        vintages: b.vintage != null ? [b.vintage] : [],
        bottleIds: [b.id],
      });
    } else {
      g.totalStars += stars;
      g.count += 1;
      if (b.vintage != null) g.vintages.push(b.vintage);
      g.bottleIds.push(b.id);
      // Prefer newest vintage as rep
      if ((b.vintage ?? -1) > (g.rep.vintage ?? -1)) g.rep = b;
    }
  }

  // Producer familiarity (Tier 3)
  const producers = new Map<string, { avg: number; n: number; name: string }>();
  for (const b of ratedBottles) {
    const stars = starsById.get(b.id);
    if (stars == null || !b.producer) continue;
    const k = normProducer(b.producer);
    if (!k) continue;
    const p = producers.get(k);
    if (!p) producers.set(k, { avg: stars, n: 1, name: b.producer });
    else {
      p.avg = (p.avg * p.n + stars) / (p.n + 1);
      p.n += 1;
    }
  }

  const matches: CellarMatch[] = [];
  const byIndex = new Map<number, CellarMatch>();

  readable.forEach((w, idx) => {
    // Tier 1: matched_bottle_id resolved AND user has rated that specific bottle.
    // Bottle rows are vintage-specific, so matched_bottle_id ∈ ratedIds implies exact vintage.
    if (w.matched_bottle_id && starsById.has(w.matched_bottle_id)) {
      const bottle = bottlesById.get(w.matched_bottle_id);
      if (bottle) {
        const m: Tier1Match = {
          tier: 1,
          scannedIndex: idx,
          scanned: w,
          bottle,
          stars: starsById.get(w.matched_bottle_id)!,
          note: noteById.get(w.matched_bottle_id) ?? null,
          isCanon: canonBottleIds.has(w.matched_bottle_id),
          isNemesis: nemesisBottleIds.has(w.matched_bottle_id),


        };
        matches.push(m);
        byIndex.set(idx, m);
        return;
      }
    }

    // Tier 2: same cuvée, different (or missing) vintage.
    const k = cuveeKey({
      producer: w.producer,
      name: w.wine_name ?? "",
      region: w.region,
      type: w.type ?? "red",
    });
    const g = byCuvee.get(k);
    if (g) {
      const m: Tier2Match = {
        tier: 2,
        scannedIndex: idx,
        scanned: w,
        repBottle: g.rep,
        avgStars: g.totalStars / g.count,
        ratedVintages: Array.from(new Set(g.vintages)).sort((a, b) => b - a),
        isCanon: g.bottleIds.some((id) => canonBottleIds.has(id)),
        isNemesis: g.bottleIds.some((id) => nemesisBottleIds.has(id)),

      };
      matches.push(m);
      byIndex.set(idx, m);
    }
  });

  // Sort: Tier 1 first, then Tier 2; within a tier, highest stars first,
  // but ≤2★ warnings sink to the bottom of Tier 1 (info you still need,
  // but not the celebratory lead).
  matches.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    const aStars = a.tier === 1 ? a.stars : a.avgStars;
    const bStars = b.tier === 1 ? b.stars : b.avgStars;
    const aWarn = a.tier === 1 && a.stars <= 2 ? 1 : 0;
    const bWarn = b.tier === 1 && b.stars <= 2 ? 1 : 0;
    if (aWarn !== bWarn) return aWarn - bWarn;
    return bStars - aStars;
  });

  return { matches, byIndex, producers };
}

export function producerLookup(
  producers: Map<string, { avg: number; n: number; name: string }>,
  producerRaw: string | null | undefined,
): { avg: number; n: number; name: string } | null {
  if (!producerRaw) return null;
  const k = normProducer(producerRaw);
  if (!k) return null;
  return producers.get(k) ?? null;
}
