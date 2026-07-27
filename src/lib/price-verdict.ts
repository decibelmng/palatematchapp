// Restaurant markup verdict vs retail baseline.
//
// The catalog does NOT carry a numeric retail price. `bottles.price_band` is
// an ordinal bucket ("$" through "$$$$$"); its midpoint is not a retail price
// and must never drive a "N.N× retail" sentence. A band midpoint can be off
// by 60%+ from true retail, which is exactly the false precision the project
// removes elsewhere.
//
// Guard: `priceVerdict` returns a verdict whose `markup` is ALWAYS null and
// whose `retailSource` is `"band"` — the caller can see that no numeric
// retail was available and MUST NOT compute a markup ratio from it.
// Downstream (`valueTag`) uses `retailSource` to refuse `kind: "markup"`
// output derived from a band.

export type PriceVerdictTone = "good" | "warn" | "bad";

/** Where the retail input came from, if any. Today only `"band"` is
 *  possible because the catalog has no numeric retail column. When a real
 *  retail source lands, add `"price"` and wire the fixture. */
export type RetailSource = "price" | "band" | null;

export type PriceVerdict = {
  tone: PriceVerdictTone;
  label: string;
  /** menu / retail. Null when retail input is a band midpoint — see guard. */
  markup: number | null;
  /** How the retail number was obtained. Callers must refuse to publish a
   *  markup ratio when this is `"band"`. */
  retailSource: RetailSource;
};

/**
 * No-op verdict.
 *
 * Historically this returned a synthetic markup by dividing menu price by
 * a band midpoint. That number is not a real markup and should never have
 * shipped as one. The function now returns null unconditionally so no
 * downstream surface can accidentally publish "N.N× retail" from a band.
 *
 * Kept as an export so existing callers keep compiling; when a numeric
 * retail column is added to the catalog, this is the only place that needs
 * to start returning a real verdict.
 */
export function priceVerdict(
  _menuAmount: number | null | undefined,
  _priceBand: string | null | undefined,
): PriceVerdict | null {
  return null;
}

/** Canonical cuvée key used for price_observations grouping. */
export function cuveeKey(producer: string | null | undefined, cuvee: string | null | undefined): string {
  return [producer, cuvee]
    .map((s) => (s ?? "").toLowerCase().trim())
    .filter(Boolean)
    .join(" · ");
}
