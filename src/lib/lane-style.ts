// Human-readable "style" name for a Canon's fingerprint, derived from the
// two axes that most differentiate it from its type centroid. Presentation
// only — no engine influence.

import type { FpKey, WineType } from "@/lib/recommender";

export type FpVec = Record<FpKey, number>;

/** Type-neutral centroid used only for style-name derivation. Approximate;
 *  the true per-pool centroid isn't available here and isn't needed for a
 *  categorical label. */
const CENTROID: Record<WineType, FpVec> = {
  red:       { fresh: 0.45, acid: 0.55, tannin: 0.55, fruit_dark: 0.60, ripe: 0.55, oak: 0.50, body: 0.60, savory: 0.50 },
  white:     { fresh: 0.65, acid: 0.65, tannin: 0,    fruit_dark: 0,    ripe: 0.45, oak: 0.35, body: 0.45, savory: 0.45 },
  sparkling: { fresh: 0.75, acid: 0.75, tannin: 0,    fruit_dark: 0,    ripe: 0.40, oak: 0.25, body: 0.35, savory: 0.45 },
  rose:      { fresh: 0.65, acid: 0.60, tannin: 0,    fruit_dark: 0,    ripe: 0.50, oak: 0.20, body: 0.40, savory: 0.45 },
  dessert:   { fresh: 0.40, acid: 0.60, tannin: 0.30, fruit_dark: 0.55, ripe: 0.80, oak: 0.55, body: 0.70, savory: 0.35 },
};

type Direction = "hi" | "lo";
type AxisPhrase = { hi: string; lo: string };

const AXIS_WORDS: Record<FpKey, AxisPhrase> = {
  fresh:      { hi: "Fresh",       lo: "Mature" },
  acid:       { hi: "Zippy",       lo: "Round" },
  tannin:     { hi: "Structured",  lo: "Soft" },
  fruit_dark: { hi: "Dark-fruited", lo: "Red-fruited" },
  ripe:       { hi: "Ripe",        lo: "Restrained" },
  oak:        { hi: "Oaked",       lo: "Unoaked" },
  body:       { hi: "Full",        lo: "Light" },
  savory:     { hi: "Savory",      lo: "Fruit-forward" },
};

/** Small hand-curated phrase table for the most evocative axis pairs.
 *  Keyed by "axisA:dirA|axisB:dirB" (order-insensitive lookup). */
const PAIR_PHRASES: Record<string, string> = {
  "body:hi|tannin:hi":       "Plush & structured",
  "fresh:lo|savory:hi":      "Mature & savory",
  "fresh:lo|oak:hi":         "Mature & oaked",
  "acid:hi|body:lo":         "Silky & perfumed",
  "acid:hi|fresh:hi":        "Bright & lively",
  "ripe:hi|oak:hi":          "Rich & polished",
  "ripe:hi|fruit_dark:hi":   "Opulent & dark-fruited",
  "tannin:hi|savory:hi":     "Firm & savory",
  "fresh:hi|savory:hi":      "Crisp & saline",
  "oak:lo|acid:hi":          "Unoaked & racy",
  "body:hi|oak:hi":          "Big & polished",
  "fruit_dark:lo|acid:hi":   "Red-fruited & bright",
};

function pairKey(a: FpKey, ad: Direction, b: FpKey, bd: Direction): string {
  const A = `${a}:${ad}`;
  const B = `${b}:${bd}`;
  return A < B ? `${A}|${B}` : `${B}|${A}`;
}

/** Ranks axes by absolute deviation from the type centroid; returns the
 *  top-N with direction. Ignores axes that don't apply to the type
 *  (centroid = 0). */
function topAxes(fp: FpVec, type: WineType, n = 2): Array<{ axis: FpKey; dir: Direction; delta: number }> {
  const c = CENTROID[type];
  const scored = (Object.keys(fp) as FpKey[])
    .filter((k) => c[k] !== 0)
    .map((k) => ({ axis: k, dir: (fp[k] >= c[k] ? "hi" : "lo") as Direction, delta: Math.abs(fp[k] - c[k]) }))
    .sort((a, b) => b.delta - a.delta);
  return scored.slice(0, n);
}

/** Human style name for a Canon, e.g. "Plush & structured". */
export function styleNameFor(fp: FpVec, type: WineType): string {
  const [a, b] = topAxes(fp, type, 2);
  if (!a) return "Distinctive";
  if (!b) return `${AXIS_WORDS[a.axis][a.dir]}`;
  const key = pairKey(a.axis, a.dir, b.axis, b.dir);
  const phrase = PAIR_PHRASES[key];
  if (phrase) return phrase;
  // Fallback: compose from the two individual words.
  const wa = AXIS_WORDS[a.axis][a.dir];
  const wb = AXIS_WORDS[b.axis][b.dir];
  return `${wa} & ${wb.toLowerCase()}`;
}
