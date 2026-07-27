import type { ScanRow } from "./types";

/** Maps predicted score to one of four plain-English verdict sentences. */
export function verdictLine(predicted: number): string {
  if (predicted >= 4.5) return "This is squarely your wine.";
  if (predicted >= 4.0) return "A strong match for your palate.";
  if (predicted >= 3.5) return "A good bet, not a bullseye.";
  return "The closest thing here, but nothing on this list is really you.";
}

/**
 * Complete sentence in sentence case. Uses the FULL untruncated wine name
 * whenever referencing a rated bottle. Contains no internal vocabulary.
 */
export function becauseLine(row: ScanRow): string {
  const r = row.ranked;

  if (r.vetoed) {
    return "Skip this one — it's a style you've consistently rated low.";
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
  if (r.predicted <= 2.6) return "Unlikely to land — it's the shape you tend to rate low.";
  return "Nothing you've rated is close enough to say much yet.";
}
