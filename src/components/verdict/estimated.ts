// Estimated lines — a line we could not find in the catalog, scored from the
// words on the list.
//
// Two facts about them, and they are separate:
//
//   1. They can be ranked and can be an alternate, but they cannot be the Call.
//      A reading inferred from "Moulis-en-Médoc" is a guess about a category,
//      not a reading of a bottle, and a thin line yields a middle-of-the-road
//      vector that sits close to everything — vagueness scoring as proximity.
//      The exception is a list where NOTHING matched: a best guess beats no
//      answer at a restaurant table.
//   2. We say so in plain words. "Estimated match" reads as a grade we awarded
//      the wine; the truth is about our catalog, not the bottle.

import type { ScanRow } from "./types";

/** The sentence, used on the row, the card and the detail sheet. */
export const ESTIMATED_SENTENCE =
  "We don't have this wine yet — scored from the list description.";

/** Chip label. Not a grade: it names where the reading came from. */
export const ESTIMATED_CHIP = "Scored from the list";

export function isEstimated(row: ScanRow): boolean {
  return !row.isCatalog;
}
