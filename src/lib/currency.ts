// Currency detection + per-currency band tables.
//
// One market at a time — a US user photographs a list printed in dollars
// and must never see a euro symbol anywhere in the interface. Bands are
// calibrated to *restaurant bottle lists*, not retail bottles.

export type CurrencyCode = "USD" | "EUR" | "GBP";

export const DEFAULT_CURRENCY: CurrencyCode = "USD";

export type PriceBandKey = "b1" | "b2" | "b3" | "b4" | "b5" | "unknown";

export type BandDef = {
  key: Exclude<PriceBandKey, "unknown">;
  max: number; // exclusive upper bound. Infinity for the top band.
  label: (fmt: (n: number) => string) => string;
};

const SYMBOL: Record<CurrencyCode, string> = {
  USD: "$",
  EUR: "\u20AC",
  GBP: "\u00A3",
};

/** Symbol- or ISO-code detection from any scanned line. Returns null when
 *  nothing recognizable is present. */
export function detectCurrencyFromText(raw: string | null | undefined): CurrencyCode | null {
  if (!raw) return null;
  const s = String(raw);
  if (s.includes("$")) return "USD";
  if (s.includes("\u20AC")) return "EUR";
  if (s.includes("\u00A3")) return "GBP";
  const upper = s.toUpperCase();
  if (/\bUSD\b/.test(upper)) return "USD";
  if (/\bEUR\b/.test(upper)) return "EUR";
  if (/\bGBP\b/.test(upper)) return "GBP";
  return null;
}

/** Aggregate the most-common currency across a set of raw strings. Never
 *  returns EUR unless positively detected. */
export function aggregateCurrency(
  samples: Array<string | null | undefined>,
  fallback: CurrencyCode = DEFAULT_CURRENCY,
): CurrencyCode {
  const counts = new Map<CurrencyCode, number>();
  for (const s of samples) {
    const c = detectCurrencyFromText(s);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (counts.size === 0) return fallback;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** Format an amount with the currency's symbol. Whole numbers render
 *  without decimals; decimals only when the source has them. */
export function formatAmount(n: number, currency: CurrencyCode): string {
  const rounded = Math.round(n) === n ? n.toString() : n.toFixed(2);
  return `${SYMBOL[currency]}${rounded}`;
}

export function currencySymbol(currency: CurrencyCode): string {
  return SYMBOL[currency];
}

// Band tables. Restaurant-bottle scale, not retail.
const BANDS_USD: BandDef[] = [
  { key: "b1", max: 50,  label: (f) => `Under ${f(50)}` },
  { key: "b2", max: 90,  label: (f) => `${f(50)}\u2013${f(90)}` },
  { key: "b3", max: 150, label: (f) => `${f(90)}\u2013${f(150)}` },
  { key: "b4", max: 300, label: (f) => `${f(150)}\u2013${f(300)}` },
  { key: "b5", max: Infinity, label: (f) => `${f(300)}+` },
];

const BANDS_EUR: BandDef[] = [
  { key: "b1", max: 40,  label: (f) => `Under ${f(40)}` },
  { key: "b2", max: 75,  label: (f) => `${f(40)}\u2013${f(75)}` },
  { key: "b3", max: 130, label: (f) => `${f(75)}\u2013${f(130)}` },
  { key: "b4", max: 250, label: (f) => `${f(130)}\u2013${f(250)}` },
  { key: "b5", max: Infinity, label: (f) => `${f(250)}+` },
];

const BANDS_GBP: BandDef[] = [
  { key: "b1", max: 35,  label: (f) => `Under ${f(35)}` },
  { key: "b2", max: 70,  label: (f) => `${f(35)}\u2013${f(70)}` },
  { key: "b3", max: 120, label: (f) => `${f(70)}\u2013${f(120)}` },
  { key: "b4", max: 220, label: (f) => `${f(120)}\u2013${f(220)}` },
  { key: "b5", max: Infinity, label: (f) => `${f(220)}+` },
];

const BANDS: Record<CurrencyCode, BandDef[]> = {
  USD: BANDS_USD,
  EUR: BANDS_EUR,
  GBP: BANDS_GBP,
};

export function bandsFor(currency: CurrencyCode): BandDef[] {
  return BANDS[currency];
}

export function bandForAmount(amount: number, currency: CurrencyCode): Exclude<PriceBandKey, "unknown"> {
  for (const b of BANDS[currency]) if (amount < b.max) return b.key;
  return "b5";
}

/** Chip options, localized to the detected currency. */
export function priceBandOptions(
  currency: CurrencyCode,
): { value: PriceBandKey | "all"; label: string }[] {
  const fmt = (n: number) => formatAmount(n, currency);
  return [
    { value: "all", label: "Any price" },
    ...BANDS[currency].map((b) => ({ value: b.key as PriceBandKey, label: b.label(fmt) })),
    { value: "unknown", label: "Price unknown" },
  ];
}
