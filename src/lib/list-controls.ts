// Shared sort + price/confidence controls used by /pour and /scan.
// All controls apply WITHIN a type section — never across types.

export type SortMode = "best" | "price_asc" | "price_desc" | "value" | "confident";
export type PriceBand = "all" | "cheap" | "mid" | "pricey" | "lux" | "unknown";

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "best", label: "Best match" },
  { value: "value", label: "Best value" },
  { value: "confident", label: "Confident matches first" },
  { value: "price_asc", label: "Price: low → high" },
  { value: "price_desc", label: "Price: high → low" },
];

export const PRICE_BAND_OPTIONS: { value: PriceBand; label: string }[] = [
  { value: "all", label: "Any price" },
  { value: "cheap", label: "Under €30" },
  { value: "mid", label: "€30–60" },
  { value: "pricey", label: "€60–120" },
  { value: "lux", label: "€120+" },
  { value: "unknown", label: "Price unknown" },
];

export type Controls = {
  sort: SortMode;
  price: PriceBand;
  catalogOnly: boolean;
};

export const DEFAULT_CONTROLS: Controls = {
  sort: "best",
  price: "all",
  catalogOnly: false,
};

/** Parse either a $-band ("$$$") or a raw menu price ("€45", "45,00", "$120")
 *  into a numeric estimate on a single € scale, plus a canonical band. */
export function normalizePrice(raw: string | null | undefined): {
  amount: number | null;
  band: PriceBand;
  display: string | null;
} {
  if (!raw) return { amount: null, band: "unknown", display: null };
  const s = String(raw).trim();
  if (!s || s.toLowerCase() === "unknown") return { amount: null, band: "unknown", display: null };

  // $-band strings from the catalog: $, $$, $$$, $$$$, $$$$$
  if (/^\$+$/.test(s)) {
    const n = s.length;
    const band: PriceBand = n <= 1 ? "cheap" : n === 2 ? "mid" : n === 3 ? "pricey" : "lux";
    const amount = { cheap: 20, mid: 45, pricey: 90, lux: 200 }[band as "cheap" | "mid" | "pricey" | "lux"];
    return { amount, band, display: s };
  }

  // Menu-price strings: extract first number (comma or dot decimal).
  const m = s.replace(/,/g, ".").match(/(\d+(?:\.\d+)?)/);
  if (!m) return { amount: null, band: "unknown", display: s };
  const amount = parseFloat(m[1]);
  const band: PriceBand =
    amount < 30 ? "cheap" :
    amount < 60 ? "mid" :
    amount < 120 ? "pricey" : "lux";
  return { amount, band, display: s };
}

export type Priced = {
  price_amount: number | null;
  price_band: PriceBand;
  price_display: string | null;
  isCatalog: boolean;
  predicted: number; // 0 when the user hasn't rated the type yet
  maxSimilarity?: number;
};

export function applyControls<T extends Priced>(items: T[], c: Controls): T[] {
  let out = items;

  if (c.catalogOnly) out = out.filter((x) => x.isCatalog);

  if (c.price !== "all") {
    if (c.price === "unknown") out = out.filter((x) => x.price_band === "unknown");
    else out = out.filter((x) => x.price_band === c.price);
  }

  const byPredictedThenSim = (a: T, b: T) => {
    if (b.predicted !== a.predicted) return b.predicted - a.predicted;
    return (b.maxSimilarity ?? 0) - (a.maxSimilarity ?? 0);
  };

  const cmp = (a: T, b: T) => {
    switch (c.sort) {
      case "price_asc": {
        const av = a.price_amount ?? Infinity;
        const bv = b.price_amount ?? Infinity;
        if (av !== bv) return av - bv;
        return byPredictedThenSim(a, b);
      }
      case "price_desc": {
        const av = a.price_amount ?? -Infinity;
        const bv = b.price_amount ?? -Infinity;
        if (av !== bv) return bv - av;
        return byPredictedThenSim(a, b);
      }
      case "value": {
        const av = a.price_amount && a.price_amount > 0 ? a.predicted / a.price_amount : -Infinity;
        const bv = b.price_amount && b.price_amount > 0 ? b.predicted / b.price_amount : -Infinity;
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

/** Great-value tag: catalog + high predicted + inexpensive. */
export function isGreatValue(x: Priced): boolean {
  return (
    x.predicted >= 3.8 &&
    x.price_amount !== null &&
    x.price_amount <= 45
  );
}
