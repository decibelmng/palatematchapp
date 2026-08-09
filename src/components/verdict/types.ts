import type { Recommendation, WineType } from "@/lib/recommender";
import type { ResolvedWine } from "@/lib/scan.functions";
import type { Priced, ValueKind } from "@/lib/list-controls";
import type { PriceVerdict } from "@/lib/price-verdict";

export type Ranked = Recommendation & { scanned: ResolvedWine };

export type ScanRow = Priced & {
  key: string;
  ranked: Ranked;
  type: WineType;
  isCatalog: boolean;
  greatValue: boolean;
  valueSentence: string | null;
  valueKind: ValueKind | null;
  verdict: PriceVerdict | null;
};


export function priceLabel(row: ScanRow): string {
  return row.price_display ?? "\u2014";
}

/**
 * The real catalog bottle id for a scanned row, or null.
 *
 * `ranked.bottle.id` is a per-scan synthetic key (`scan-3`) minted by the
 * ranking pipeline — it is NOT a bottles.id and must never be written to a
 * column that references bottles. Every persisted answer about a scanned wine
 * goes through here.
 */
export function outcomeBottleId(row: ScanRow): string | null {
  return row.ranked.scanned.matched_bottle_id ?? null;
}

