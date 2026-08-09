import type { ScanRow } from "./types";

/**
 * Vintage honesty, in the person's terms.
 *
 * A person at a table has a wine list, not a database. So we never talk about
 * what we "have" as an inventory fact first — we name the wine we scored, then
 * admit the score came off a different year, because that is the part that
 * might be wrong.
 */
export type ApproxVintage = {
  /** The year printed on the list. */
  scanned: number | null;
  /** The year of the bottle the score was actually computed from. */
  matched: number;
};

export function approxVintage(row: ScanRow): ApproxVintage | null {
  const s = row.ranked.scanned;
  if (!s?.vintage_approx) return null;
  if (s.matched_vintage == null) return null;
  return { scanned: s.vintage ?? null, matched: s.matched_vintage };
}

/** True when the score was computed from the exact year the list showed. */
export function isExactVintage(row: ScanRow): boolean {
  return approxVintage(row) == null;
}

/** Short chip, Call only. Sits at the same weight as "Estimated match". */
export function approxChipLabel(a: ApproxVintage): string {
  return `Scored off the ${a.matched}`;
}

/** The chip's expansion, and the quiet single line used on list rows. */
export function approxCaveat(a: ApproxVintage): string {
  return a.scanned != null
    ? `Scored off the ${a.matched} — we don't have the ${a.scanned} yet. Same producer, different year.`
    : `Scored off the ${a.matched} — the list didn't show a year. Same producer, different year.`;
}

/** The line that goes directly under the wine name: the year we scored, then the caveat. */
export function approxSubline(a: ApproxVintage): string {
  return a.scanned != null
    ? `${a.matched} · we don't have the ${a.scanned} yet`
    : `${a.matched} · the list didn't show a year`;
}
