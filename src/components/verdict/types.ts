import type { Recommendation, WineType } from "@/lib/recommender";
import type { ResolvedWine } from "@/lib/scan.functions";
import type { Priced } from "@/lib/list-controls";
import type { PriceVerdict } from "@/lib/price-verdict";

export type Ranked = Recommendation & { scanned: ResolvedWine };

export type ScanRow = Priced & {
  key: string;
  ranked: Ranked;
  type: WineType;
  isCatalog: boolean;
  greatValue: boolean;
  valueSentence: string | null;
  verdict: PriceVerdict | null;
};

export function priceLabel(row: ScanRow): string {
  return row.price_display ?? "\u2014";
}
