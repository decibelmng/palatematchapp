// Client-side helpers for the feed prediction band:
//   - reasonForPrediction(): plain-language single-sentence reason from the
//     nearest anchor's largest axis diff.
//   - calibrationPct(): 0..100 palate calibration per wine type from the
//     viewer's rating count for that type (well-pinned ≥ 20, thin < 8).
//   - confidenceCopy(): copy variants keyed to calibration + prediction.
//
// Read-only — never touches fp_observations or writes anything.

import { RAX, hasAxis, type FpKey, type WineType, type RatedFp } from "./recommender";

export type CalibrationBand = "thin" | "medium" | "strong";

export function calibrationPct(nRatedOfType: number): number {
  // 0 at 0 ratings, 100 at ≥ 20. Matches scan MIN_PER_TYPE=8 as the
  // thin/medium boundary (40%).
  const p = Math.min(1, nRatedOfType / 20);
  return Math.round(p * 100);
}

export function calibrationBand(pct: number): CalibrationBand {
  if (pct >= 70) return "strong";
  if (pct >= 40) return "medium";
  return "thin";
}

/** Human copy for the confidence line under the predicted score. */
export function confidenceCopy(
  band: CalibrationBand,
  predicted: number,
  type: WineType,
): { headline: string; caveat: string | null } {
  const typeLabel = type === "red" ? "reds"
    : type === "white" ? "whites"
    : type === "sparkling" ? "sparkling"
    : type === "rose" ? "rosés"
    : "dessert wines";
  if (band === "thin") {
    return {
      headline: predicted >= 4 ? "Might be for you" : predicted >= 3 ? "Worth a taste" : "Unsure yet",
      caveat: `Lightly held — rate a few more ${typeLabel} to sharpen this.`,
    };
  }
  if (band === "medium") {
    return {
      headline: predicted >= 4 ? "Looks like your lane" : predicted >= 3 ? "Middle-ground" : "Probably not for you",
      caveat: null,
    };
  }
  return {
    headline: predicted >= 4.3 ? "A strong match for you"
      : predicted >= 3.5 ? "In your lane"
      : predicted >= 2.5 ? "Middle-ground for you"
      : "Runs against your palate",
    caveat: null,
  };
}

// ────────── Reason from nearest-axis difference ──────────

const AXIS_HIGH: Record<FpKey, string> = {
  fresh: "fresh, chilled-fruit feel",
  acid: "high acidity",
  tannin: "grippy tannin",
  fruit_dark: "dark, brooding fruit",
  ripe: "ripe, jammy fruit",
  oak: "assertive oak",
  body: "big, full body",
  savory: "savory, earthy notes",
};
const AXIS_LOW: Record<FpKey, string> = {
  fresh: "warmer, softer fruit",
  acid: "softer acidity",
  tannin: "silky, low tannin",
  fruit_dark: "bright red-fruit character",
  ripe: "restrained ripeness",
  oak: "restrained oak",
  body: "lighter body",
  savory: "fruit-forward feel",
};

const RED_ONLY = new Set<FpKey>(["tannin", "fruit_dark"]);

/**
 * One-sentence reason based on the axis where the candidate diverges *most*
 * from the nearest positive anchor in the viewer's palate. Falls back to a
 * calm "outside your usual pattern" when we have no positive anchor of the
 * same type.
 *
 * `predicted` selects tone: high → "matches your lane on X", low → "runs
 * against your palate on X".
 */
export function reasonForPrediction(args: {
  candidateFp: Record<FpKey, number>;
  type: WineType;
  ratedSameType: RatedFp[];
  predicted: number;
}): string {
  const { candidateFp, type, ratedSameType, predicted } = args;
  if (ratedSameType.length === 0) return "Not enough rated wines of this type yet.";

  // Nearest anchor by unweighted L2 (reason is a UX explanation, not the
  // scoring path — ω-weighting isn't needed here and keeps the reason legible).
  let nearest: RatedFp | null = null;
  let nearestDist = Infinity;
  for (const r of ratedSameType) {
    let d = 0;
    for (const a of RAX) {
      if (RED_ONLY.has(a) && !(type === "red" || type === "dessert")) continue;
      if (!hasAxis(candidateFp, a) || !hasAxis(r.fp, a)) continue;
      const diff = (candidateFp[a] as number) - (r.fp[a] as number);
      d += diff * diff;
    }
    d = Math.sqrt(d);
    if (d < nearestDist) { nearestDist = d; nearest = r; }
  }
  if (!nearest) return "Outside your usual pattern.";

  // Largest signed axis diff vs that anchor.
  let bestAxis: FpKey | null = null;
  let bestAbs = 0;
  let bestSigned = 0;
  for (const a of RAX) {
    if (RED_ONLY.has(a) && !(type === "red" || type === "dessert")) continue;
    if (!hasAxis(candidateFp, a) || !hasAxis(nearest.fp, a)) continue;
    const d = (candidateFp[a] as number) - (nearest.fp[a] as number);
    if (Math.abs(d) > bestAbs) { bestAbs = Math.abs(d); bestSigned = d; bestAxis = a; }
  }
  if (!bestAxis || bestAbs < 0.05) {
    return predicted >= 4
      ? `Sits right next to your ${nearest.name}.`
      : `Similar to your ${nearest.name} — but not exciting for you.`;
  }
  const trait = bestSigned > 0 ? AXIS_HIGH[bestAxis] : AXIS_LOW[bestAxis];
  if (predicted >= 4) {
    return `${capitalize(trait)} — right in your lane.`;
  }
  if (predicted <= 2.5) {
    return `${capitalize(trait)} runs against your palate.`;
  }
  return `${capitalize(trait)} — a step off your usual.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}
