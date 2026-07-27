import type { ScanRow } from "./types";
import type { FpKey } from "@/lib/recommender";
import { VERDICT_NEG, describeVetoStyleFromFp } from "@/lib/axis-phrases";

/** Maps a for-you score to one of four plain-English verdict sentences.
 *  This is the SHARED source of truth: scan.bottle and TheCall both call it,
 *  so the two screens can never disagree about the same wine. */
export function verdictLine(predicted: number): string {
  if (predicted >= 4.5) return "This is squarely your wine.";
  if (predicted >= 4.0) return "A strong match for your palate.";
  if (predicted >= 3.5) return "A good bet, not a bullseye.";
  return "Not really your style.";
}


/**
 * Pick a complaint phrase for a wine sitting in the low-score basin, using
 * whichever direction of whichever axis is furthest from neutral AND is
 * something a person actually complains about. Returns "" when no axis
 * qualifies (the caller then falls back to a generic line).
 */
function dominantComplaint(
  fp: Record<FpKey, number> | null | undefined,
  drivingAxes: readonly FpKey[] = [],
): string {
  return describeVetoStyleFromFp(fp, drivingAxes);
}

/**
 * Complete sentence in sentence case. Uses the FULL untruncated wine name
 * whenever referencing a rated bottle. Contains no internal vocabulary.
 */
export function becauseLine(row: ScanRow): string {
  const r = row.ranked;

  if (r.vetoed) {
    // Sign-aware: the recommender's driving axes tell us WHICH axes pushed
    // this into the low basin; describeVetoStyleFromFp then reads the sign
    // of the fp on those axes so the phrase matches the WINE, not a fixed
    // "high side" assumption. Fallback line uses no axis vocabulary at all.
    const driving = r.vetoReason?.drivingAxes ?? [];
    const style = dominantComplaint(r.bottle.fp, driving);
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
    const style = dominantComplaint(r.bottle.fp);
    return style
      ? `Unlikely to land — it's the ${style} shape you tend to rate low.`
      : "Unlikely to land — it's the shape you tend to rate low.";
  }
  return "Nothing you've rated is close enough to say much yet.";
}

// Re-export for any legacy caller that imported the phrase table by name.
export { VERDICT_NEG as AXIS_HIGH_PHRASE };
