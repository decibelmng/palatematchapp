// Currency detection + per-currency band tables.
//
// One market at a time — a US user photographs a list printed in dollars
// and must never see a euro symbol anywhere in the interface. Bands are
// calibrated to *restaurant bottle lists*, not retail bottles.

export type CurrencyCode = "USD" | "EUR" | "GBP";

export const DEFAULT_CURRENCY: CurrencyCode = "USD";

export type PriceBandKey = "b1" | "b2" | "b3" | "b4" | "b5" | "unknown";

/** Serving format the band table is calibrated to. Bottle bands are
 *  restaurant-list scale ($50–$300+); glass bands are pour scale ($15–$40+). */
export type BandFormat = "bottle" | "glass";

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

/** ISO-3166 country → currency. Extend as needed. Only currencies in
 *  {@link CurrencyCode} are supported today. */
const COUNTRY_TO_CURRENCY: Record<string, CurrencyCode> = {
  US: "USD", CA: "USD",
  GB: "GBP", UK: "GBP",
  FR: "EUR", DE: "EUR", IT: "EUR", ES: "EUR", NL: "EUR", BE: "EUR",
  AT: "EUR", PT: "EUR", IE: "EUR", GR: "EUR", FI: "EUR", LU: "EUR",
};

export function currencyFromCountry(code: string | null | undefined): CurrencyCode | null {
  if (!code) return null;
  return COUNTRY_TO_CURRENCY[code.toUpperCase()] ?? null;
}

/** Resolve a currency from the user's browser locale ("en-US" → USD).
 *  Returns null when the locale region isn't in the mapping. Safe to call in
 *  SSR — reads window.navigator only when present. */
export function currencyFromLocale(): CurrencyCode | null {
  if (typeof navigator === "undefined") return null;
  const lang = navigator.language || (navigator.languages && navigator.languages[0]);
  if (!lang) return null;
  const parts = lang.split("-");
  const region = parts.length >= 2 ? parts[parts.length - 1] : parts[0];
  return currencyFromCountry(region);
}

/**
 * Full currency-resolution chain, in priority order:
 *   1. explicit override (already-computed scan currency)
 *   2. per-row detection from OCR
 *   3. restaurant country
 *   4. browser locale
 *   5. USD default
 * Returns both the winning currency and which step fired, for logging.
 */
export function resolveCurrency(opts: {
  override?: CurrencyCode | null;
  samples?: Array<string | null | undefined>;
  restaurantCountry?: string | null;
  useLocale?: boolean;
}): { currency: CurrencyCode; source: "override" | "text" | "restaurant" | "locale" | "default" } {
  if (opts.override) return { currency: opts.override, source: "override" };
  if (opts.samples && opts.samples.length > 0) {
    const counts = new Map<CurrencyCode, number>();
    for (const s of opts.samples) {
      const c = detectCurrencyFromText(s);
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    if (counts.size > 0) {
      const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { currency: winner, source: "text" };
    }
  }
  const fromCountry = currencyFromCountry(opts.restaurantCountry ?? null);
  if (fromCountry) return { currency: fromCountry, source: "restaurant" };
  if (opts.useLocale !== false) {
    const fromLocale = currencyFromLocale();
    if (fromLocale) return { currency: fromLocale, source: "locale" };
  }
  return { currency: DEFAULT_CURRENCY, source: "default" };
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

// ============================================================
// Band tables — one per (currency, format) pair. Bottle bands are
// restaurant-list scale; glass bands are pour scale. Bucket switches
// with the active format so a By-the-glass filter is actually usable.
// ============================================================

const BANDS_BOTTLE_USD: BandDef[] = [
  { key: "b1", max: 50,  label: (f) => `Under ${f(50)}` },
  { key: "b2", max: 90,  label: (f) => `${f(50)}\u2013${f(90)}` },
  { key: "b3", max: 150, label: (f) => `${f(90)}\u2013${f(150)}` },
  { key: "b4", max: 300, label: (f) => `${f(150)}\u2013${f(300)}` },
  { key: "b5", max: Infinity, label: (f) => `${f(300)}+` },
];

const BANDS_BOTTLE_EUR: BandDef[] = [
  { key: "b1", max: 40,  label: (f) => `Under ${f(40)}` },
  { key: "b2", max: 75,  label: (f) => `${f(40)}\u2013${f(75)}` },
  { key: "b3", max: 130, label: (f) => `${f(75)}\u2013${f(130)}` },
  { key: "b4", max: 250, label: (f) => `${f(130)}\u2013${f(250)}` },
  { key: "b5", max: Infinity, label: (f) => `${f(250)}+` },
];

const BANDS_BOTTLE_GBP: BandDef[] = [
  { key: "b1", max: 35,  label: (f) => `Under ${f(35)}` },
  { key: "b2", max: 70,  label: (f) => `${f(35)}\u2013${f(70)}` },
  { key: "b3", max: 120, label: (f) => `${f(70)}\u2013${f(120)}` },
  { key: "b4", max: 220, label: (f) => `${f(120)}\u2013${f(220)}` },
  { key: "b5", max: Infinity, label: (f) => `${f(220)}+` },
];

const BANDS_GLASS_USD: BandDef[] = [
  { key: "b1", max: 15, label: (f) => `Under ${f(15)}` },
  { key: "b2", max: 25, label: (f) => `${f(15)}\u2013${f(25)}` },
  { key: "b3", max: 40, label: (f) => `${f(25)}\u2013${f(40)}` },
  { key: "b4", max: Infinity, label: (f) => `${f(40)}+` },
];

const BANDS_GLASS_EUR: BandDef[] = [
  { key: "b1", max: 12, label: (f) => `Under ${f(12)}` },
  { key: "b2", max: 20, label: (f) => `${f(12)}\u2013${f(20)}` },
  { key: "b3", max: 35, label: (f) => `${f(20)}\u2013${f(35)}` },
  { key: "b4", max: Infinity, label: (f) => `${f(35)}+` },
];

const BANDS_GLASS_GBP: BandDef[] = [
  { key: "b1", max: 10, label: (f) => `Under ${f(10)}` },
  { key: "b2", max: 18, label: (f) => `${f(10)}\u2013${f(18)}` },
  { key: "b3", max: 30, label: (f) => `${f(18)}\u2013${f(30)}` },
  { key: "b4", max: Infinity, label: (f) => `${f(30)}+` },
];

const BANDS: Record<BandFormat, Record<CurrencyCode, BandDef[]>> = {
  bottle: { USD: BANDS_BOTTLE_USD, EUR: BANDS_BOTTLE_EUR, GBP: BANDS_BOTTLE_GBP },
  glass:  { USD: BANDS_GLASS_USD,  EUR: BANDS_GLASS_EUR,  GBP: BANDS_GLASS_GBP  },
};

export function bandsFor(currency: CurrencyCode, format: BandFormat = "bottle"): BandDef[] {
  return BANDS[format][currency];
}

export function bandForAmount(
  amount: number,
  currency: CurrencyCode,
  format: BandFormat = "bottle",
): Exclude<PriceBandKey, "unknown"> {
  for (const b of BANDS[format][currency]) if (amount < b.max) return b.key;
  const last = BANDS[format][currency];
  return last[last.length - 1].key;
}

/** Chip options, localized to the detected currency AND active format. */
export function priceBandOptions(
  currency: CurrencyCode,
  format: BandFormat = "bottle",
): { value: PriceBandKey | "all"; label: string }[] {
  const fmt = (n: number) => formatAmount(n, currency);
  return [
    { value: "all", label: "Any price" },
    ...BANDS[format][currency].map((b) => ({ value: b.key as PriceBandKey, label: b.label(fmt) })),
    { value: "unknown", label: "Price unknown" },
  ];
}

