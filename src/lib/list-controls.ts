// Shared sort + price/confidence controls used by /pour and /scan.
// All controls apply WITHIN a type section — never across types.

import {
  bandForAmount,
  formatAmount,
  detectCurrencyFromText,
  type CurrencyCode,
  type PriceBandKey,
} from "@/lib/currency";
import { priceVerdict, type PriceVerdict } from "@/lib/price-verdict";

export type SortMode = "best" | "price_asc" | "price_desc" | "value" | "confident";
export type PriceBand = PriceBandKey | "all";
export type WineTypeFilter = "all" | "red" | "white" | "rose" | "sparkling" | "dessert";
export type ServingFormat = "bottle" | "glass";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "best", label: "Best match" },
  { value: "value", label: "Best value" },
  { value: "confident", label: "Confident matches first" },
  { value: "price_asc", label: "Price: low \u2192 high" },
  { value: "price_desc", label: "Price: high \u2192 low" },
];

export const WINE_TYPE_OPTIONS: { value: WineTypeFilter; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "red", label: "Red" },
  { value: "white", label: "White" },
  { value: "rose", label: "Ros\u00e9" },
  { value: "sparkling", label: "Sparkling" },
  { value: "dessert", label: "Dessert" },
];

export type Controls = {
  sort: SortMode;
  price: PriceBand;
  wineType: WineTypeFilter;
  catalogOnly: boolean;
  format: ServingFormat;
};

export const DEFAULT_CONTROLS: Controls = {
  sort: "best",
  price: "all",
  wineType: "all",
  catalogOnly: false,
  format: "bottle",
};

/** Parse a raw menu-price string. Returns primary amount, currency, band,
 *  display, and — when the source encodes both formats ("14 / 52" style) —
 *  the split into glass + bottle amounts. */
export function normalizePrice(
  raw: string | null | undefined,
  hintCurrency: CurrencyCode,
): {
  amount: number | null;
  band: PriceBand;
  display: string | null;
  currency: CurrencyCode;
  glass: number | null;
  bottle: number | null;
} {
  if (!raw) {
    return { amount: null, band: "unknown", display: null, currency: hintCurrency, glass: null, bottle: null };
  }
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "unknown") {
    return { amount: null, band: "unknown", display: null, currency: hintCurrency, glass: null, bottle: null };
  }

  const currency = detectCurrencyFromText(s) ?? hintCurrency;

  // "$$$" retail-style bands — legacy catalog paths only.
  if (/^\$+$/.test(s)) {
    // Retail bands don't carry actual amounts. Keep them as unknown for
    // list purposes; the retail-band caveat is now handled elsewhere.
    return { amount: null, band: "unknown", display: s, currency, glass: null, bottle: null };
  }

  // Extract numbers. Handles "14 / 52", "18|65", "45,00", "$120".
  const nums = extractNumbers(s);
  if (nums.length === 0) {
    return { amount: null, band: "unknown", display: s, currency, glass: null, bottle: null };
  }

  let glass: number | null = null;
  let bottle: number | null = null;
  let primary: number;
  if (nums.length >= 2 && looksLikeGlassBottle(nums[0], nums[1])) {
    glass = nums[0];
    bottle = nums[1];
    primary = bottle;
  } else {
    primary = nums[0];
    // Single number with a glass hint — attribute to glass, not bottle.
    if (/\bgl\b|\bglass\b|\bby[- ]the[- ]glass\b|\bbtg\b/i.test(s)) {
      glass = primary;
    } else {
      bottle = primary;
    }
  }

  return {
    amount: primary,
    band: bandForAmount(primary, currency),
    display: formatAmount(primary, currency),
    currency,
    glass,
    bottle,
  };
}

function extractNumbers(s: string): number[] {
  const out: number[] = [];
  const re = /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    // Treat a comma as decimal if it splits a short tail (","5 or ",50"),
    // otherwise as thousands. Simpler heuristic: replace , with . when the
    // segment after the comma is 1-2 digits, else strip it.
    const raw = m[1];
    let clean = raw;
    if (/,\d{1,2}$/.test(raw)) clean = raw.replace(",", ".");
    else clean = raw.replace(/[.,](?=\d{3}\b)/g, "");
    const n = Number(clean);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

function looksLikeGlassBottle(a: number, b: number): boolean {
  // "N / M" glass/bottle pattern: bottle is typically 2.5\u20135\u00d7 glass.
  if (a <= 0 || b <= 0) return false;
  if (b <= a) return false;
  const ratio = b / a;
  return ratio >= 2 && ratio <= 8;
}

export type Priced = {
  price_amount: number | null;
  price_band: PriceBand;
  price_display: string | null;
  currency: CurrencyCode;
  format: ServingFormat;
  price_glass: number | null;
  price_bottle: number | null;
  isCatalog: boolean;
  predicted: number; // 0 when the user hasn't rated the type yet
  maxSimilarity?: number;
  type?: string;
};

export function applyControls<T extends Priced>(items: T[], c: Controls): T[] {
  let out = items;

  if (c.catalogOnly) out = out.filter((x) => x.isCatalog);

  if (c.wineType && c.wineType !== "all") {
    out = out.filter((x) => (x.type ?? "red") === c.wineType);
  }

  // Format filter: a row participates in a format only if it has a price
  // in that format, or has no format-specific split (unknown pricing).
  out = out.filter((x) => {
    if (x.price_amount == null) return true;
    if (c.format === "bottle") return x.price_bottle != null || (x.price_glass == null);
    return x.price_glass != null;
  });

  if (c.price !== "all") {
    if (c.price === "unknown") out = out.filter((x) => x.price_band === "unknown");
    else out = out.filter((x) => bandOfActive(x, c.format) === c.price);
  }

  const byPredictedThenSim = (a: T, b: T) => {
    if (b.predicted !== a.predicted) return b.predicted - a.predicted;
    return (b.maxSimilarity ?? 0) - (a.maxSimilarity ?? 0);
  };

  const cmp = (a: T, b: T) => {
    switch (c.sort) {
      case "price_asc": {
        const av = activeAmount(a, c.format) ?? Infinity;
        const bv = activeAmount(b, c.format) ?? Infinity;
        if (av !== bv) return av - bv;
        return byPredictedThenSim(a, b);
      }
      case "price_desc": {
        const av = activeAmount(a, c.format) ?? -Infinity;
        const bv = activeAmount(b, c.format) ?? -Infinity;
        if (av !== bv) return bv - av;
        return byPredictedThenSim(a, b);
      }
      case "value": {
        const aa = activeAmount(a, c.format);
        const bb = activeAmount(b, c.format);
        const av = aa && aa > 0 ? a.predicted / aa : -Infinity;
        const bv = bb && bb > 0 ? b.predicted / bb : -Infinity;
        if (av !== bv) return bv - av;
        return byPredictedThenSim(a, b);
      }
      case "confident": {
        if (a.isCatalog !== b.isCatalog) return a.isCatalog ? -1 : 1;
        return byPredictedThenSim(a, b);
      }
      case "best":
      default:
        return byPredictedThenSim(a, b);
    }
  };

  return [...out].sort(cmp);
}

function activeAmount(x: Priced, fmt: ServingFormat): number | null {
  if (fmt === "glass") return x.price_glass ?? null;
  return x.price_bottle ?? x.price_amount ?? null;
}

function bandOfActive(x: Priced, fmt: ServingFormat): PriceBand {
  const amt = activeAmount(x, fmt);
  if (amt == null) return "unknown";
  return bandForAmount(amt, x.currency);
}

/** Whether the row set contains rows priced in each format. Used to decide
 *  whether to expose the by-the-glass / by-the-bottle toggle at all. */
export function detectFormatsPresent(rows: Priced[]): { glass: boolean; bottle: boolean } {
  let glass = false;
  let bottle = false;
  for (const r of rows) {
    if (r.price_glass != null) glass = true;
    if (r.price_bottle != null || r.format === "bottle") bottle = true;
    if (glass && bottle) break;
  }
  return { glass, bottle };
}

// ---------- Value tags: relative to the list in hand ----------

export type ValueTag = { ok: boolean; sentence: string | null };

export type ValueContext = {
  rowMarkup: Map<string, number>;
  medianMarkup: number | null;
  topQuartilePredicted: number | null;
  bottomThirdPrice: number | null;
};

/** Prepare list-level statistics used to decide value tags. */
export function computeValueContext(
  rows: Array<Priced & { key: string; verdict?: PriceVerdict | null }>,
  fmt: ServingFormat,
): ValueContext {
  const rowMarkup = new Map<string, number>();
  const markups: number[] = [];
  for (const r of rows) {
    const m = r.verdict?.markup;
    if (m != null && Number.isFinite(m) && m > 0) {
      rowMarkup.set(r.key, m);
      markups.push(m);
    }
  }
  const medianMarkup = markups.length >= 4 ? median(markups) : null;

  const prices: number[] = [];
  const predicted: number[] = [];
  for (const r of rows) {
    const a = fmt === "glass" ? r.price_glass : r.price_bottle ?? r.price_amount;
    if (a != null && Number.isFinite(a) && a > 0) prices.push(a);
    if (r.predicted && r.predicted > 0) predicted.push(r.predicted);
  }
  const topQuartilePredicted = predicted.length >= 4 ? quantile(predicted, 0.75) : null;
  const bottomThirdPrice = prices.length >= 4 ? quantile(prices, 1 / 3) : null;

  return { rowMarkup, medianMarkup, topQuartilePredicted, bottomThirdPrice };
}

/** Value verdict for one row, relative to the list. Returns a full sentence
 *  when it fires, otherwise ok=false. */
export function valueTag(
  row: Priced & { key: string; verdict?: PriceVerdict | null },
  ctx: ValueContext,
  fmt: ServingFormat,
): ValueTag {
  const rowM = ctx.rowMarkup.get(row.key);
  const activeAmt = fmt === "glass" ? row.price_glass : row.price_bottle ?? row.price_amount;

  // Primary: markup vs list median. "Materially below" = at least 25% lower.
  if (rowM != null && ctx.medianMarkup != null && ctx.medianMarkup > 0) {
    if (rowM <= ctx.medianMarkup * 0.75) {
      const s = `About ${rowM.toFixed(1)}\u00d7 retail \u2014 most of this list is ${ctx.medianMarkup.toFixed(1)}\u00d7.`;
      return { ok: true, sentence: s };
    }
    return { ok: false, sentence: null };
  }

  // Fallback: no retail known. Top-quartile prediction AND bottom-third price.
  if (
    activeAmt != null &&
    row.predicted > 0 &&
    ctx.topQuartilePredicted != null &&
    ctx.bottomThirdPrice != null &&
    row.predicted >= ctx.topQuartilePredicted &&
    activeAmt <= ctx.bottomThirdPrice
  ) {
    const priceStr = formatAmount(activeAmt, row.currency);
    return {
      ok: true,
      sentence: `${priceStr} lands in the bottom third of this list \u2014 and it's one of your top-scoring bottles here.`,
    };
  }

  return { ok: false, sentence: null };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// Legacy export retained for callers not yet migrated to computeValueContext.
export function isGreatValue(_x: Priced): boolean {
  return false;
}

// Re-export for callers that used to import the price-verdict helper via
// list-controls. Keeps downstream imports stable.
export { priceVerdict };
