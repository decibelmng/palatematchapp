import type { ScanRow } from "./types";
import type { FpKey } from "@/lib/recommender";

/** Maps predicted score to one of four plain-English verdict sentences. */
export function verdictLine(predicted: number): string {
  if (predicted >= 4.5) return "This is squarely your wine.";
  if (predicted >= 4.0) return "A strong match for your palate.";
  if (predicted >= 3.5) return "A good bet, not a bullseye.";
  return "The closest thing here, but nothing on this list is really you.";
}

// Sensory phrasing per fingerprint axis, at the "high" end. These describe
// the WINE's character in language a person can check against the glass,
// never in axis names.
const AXIS_HIGH_PHRASE: Record<FpKey, string> = {
  fresh: "bracing, high-tension",
  acid: "sharp, high-acid",
  tannin: "drying, grippy",
  fruit_dark: "dark-fruited and brooding",
  ripe: "jammy, over-ripe",
  oak: "heavily oaked",
  body: "big, full-bodied",
  savory: "savory, earthy",
};

/**
 * Given a wine's fingerprint, name the most prominent sensory dimension —
 * whatever axis sits highest and clearest above the neutral midpoint.
 * Falls back to a generic phrase only when the fp is missing or truly flat.
 */
function dominantStyleFromFp(fp: Record<FpKey, number> | null | undefined): string {
  if (!fp) return "";
  let bestKey: FpKey | null = null;
  let bestExcess = 0;
  for (const [k, v] of Object.entries(fp) as [FpKey, number][]) {
    const excess = (v ?? 0.5) - 0.5;
    if (excess > bestExcess) { bestExcess = excess; bestKey = k; }
  }
  // Require a real deviation from neutral — a flat fp gets a generic fallback.
  if (!bestKey || bestExcess < 0.10) return "";
  return AXIS_HIGH_PHRASE[bestKey];
}

/**
 * Complete sentence in sentence case. Uses the FULL untruncated wine name
 * whenever referencing a rated bottle. Contains no internal vocabulary.
 */
export function becauseLine(row: ScanRow): string {
  const r = row.ranked;

  if (r.vetoed) {
    // Prefer the recommender's own driving axes; if that's absent, derive
    // from the wine's fingerprint. Either way, the line names a specific
    // sensory style the user can verify.
    const driving = r.vetoReason?.drivingAxes ?? [];
    let style = driving.map((k) => AXIS_HIGH_PHRASE[k]).filter(Boolean)[0] ?? "";
    if (!style) style = dominantStyleFromFp(r.bottle.fp);
    if (style) return `Skip this one — it's the ${style} style you've consistently rated low.`;
    return "Skip this one — it lands in the exact style you've consistently rated low.";
  }
  if (r.contested) {
    return "One of your favorite styles brushes up against a style you dislike here — worth a look, not a lock.";
  }
  if (r.nearest) {
    const n = r.nearest;
    const fullName = n.name.trim();
    if (n.stars >= 4) {
      return `It sits right next to the ${fullName} you gave ${n.stars}★ — the same profile, in the same neighborhood.`;
    }
    if (n.stars <= 2) {
      return `It's uncomfortably close to the ${fullName} you only gave ${n.stars}★.`;
    }
    return `Reminds me of the ${fullName} you rated ${n.stars}★ — similar territory, middle of the road for you.`;
  }
  if (r.predicted >= 4.3) return "Your kind of wine, from the shape of everything you've rated.";
  if (r.predicted >= 3.8) return "A strong match for your palate.";
  if (r.predicted <= 2.6) {
    const style = dominantStyleFromFp(r.bottle.fp);
    return style
      ? `Unlikely to land — it's the ${style} shape you tend to rate low.`
      : "Unlikely to land — it's the shape you tend to rate low.";
  }
  return "Nothing you've rated is close enough to say much yet.";
}
