import type { StoredScanRow } from "@/lib/scans-history.functions";
import type { ResolvedWine } from "@/lib/scan.functions";
import type { CurrencyCode } from "@/lib/currency";

/** Map a stored scan row (DB shape) into the ResolvedWine the live ranking
 *  pipeline consumes, so a reopened OR shared scan renders the same
 *  VerdictSurface as a live scan — not the flatter RankedScanList fallback. */
export function storedRowToResolved(w: StoredScanRow): ResolvedWine {
  const src: ResolvedWine["fp_source"] =
    w.fp_source === "catalog" ? "catalog" : w.fp_source === "unreadable" ? "unreadable" : "estimated";
  return {
    producer: w.producer,
    wine_name: w.cuvee,
    vintage: w.vintage,
    region: w.region,
    grape: w.grape,
    price: w.price,
    type: (w.wine_type as ResolvedWine["type"]) ?? null,
    fp: w.fp ?? null,
    confidence: null,
    fp_resolved: w.fp ?? null,
    fp_source: src,
    matched_bottle_id: w.matched_bottle_id,
    matched_bottle_name: null,
    match_score: w.match_score ?? 0,
  };
}

/** Dominant known currency across a stored scan's rows (null → let the ranking
 *  chain fall back to OCR text / restaurant / locale). */
export function currencyOfStoredRows(wines: StoredScanRow[]): CurrencyCode | null {
  const c = wines.map((w) => w.currency).find(Boolean);
  return c === "EUR" || c === "GBP" || c === "USD" ? c : null;
}
