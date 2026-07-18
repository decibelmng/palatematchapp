// Restaurant markup verdict vs retail baseline.
//
// Compares a menu price against the retail midpoint implied by the catalog
// bottle's `price_band` ("$" through "$$$$$"). Restaurants typically mark
// wine up 2–3× retail; we surface a chip when a bottle is priced fairly
// (green), steeply (amber), or gouged (red).

export type PriceVerdictTone = "good" | "warn" | "bad";

export type PriceVerdict = {
  tone: PriceVerdictTone;
  label: string;
  /** menu / retail midpoint; null when either input is missing. */
  markup: number | null;
};

// Retail midpoints (USD) per catalog band. Deliberately conservative —
// wide bands, but stable enough for markup ratios that don't oscillate on
// a single-dollar price change.
const RETAIL_MIDPOINT: Record<string, number> = {
  $: 15,
  $$: 30,
  $$$: 60,
  $$$$: 120,
  $$$$$: 250,
};

export function retailMidpoint(band: string | null | undefined): number | null {
  if (!band) return null;
  return RETAIL_MIDPOINT[band] ?? null;
}

/**
 * Compute the verdict.
 *  - green:  markup ≤ 1.5×   ("fair price")
 *  - amber:  1.5× < markup ≤ 2.5×   ("typical markup")
 *  - red:    markup > 2.5×   ("steep markup")
 * Returns null when we lack either the menu price or a retail band.
 */
export function priceVerdict(
  menuAmount: number | null | undefined,
  priceBand: string | null | undefined,
): PriceVerdict | null {
  if (!menuAmount || menuAmount <= 0) return null;
  const retail = retailMidpoint(priceBand);
  if (!retail) return null;
  const markup = menuAmount / retail;
  if (markup <= 1.5) return { tone: "good", label: `fair · ${markup.toFixed(1)}× retail`, markup };
  if (markup <= 2.5) return { tone: "warn", label: `typical · ${markup.toFixed(1)}× retail`, markup };
  return { tone: "bad", label: `steep · ${markup.toFixed(1)}× retail`, markup };
}

/** Canonical cuvée key used for price_observations grouping. */
export function cuveeKey(producer: string | null | undefined, cuvee: string | null | undefined): string {
  return [producer, cuvee]
    .map((s) => (s ?? "").toLowerCase().trim())
    .filter(Boolean)
    .join(" · ");
}
