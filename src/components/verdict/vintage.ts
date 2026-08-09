import type { ScanRow } from "./types";

/**
 * Vintage honesty, in the person's terms.
 *
 * A person at a table has a wine list, not a database. So we never talk about
 * what we "have" as an inventory fact first — we name the wine we scored, then
 * admit the score came off a different year, because that is the part that
 * might be wrong.
 *
 * Three tiers, keyed off the size of the gap:
 *
 *   ≤ 2 years  no chip at all. Adjacent vintages of the same cuvée are the
 *              same wine in every way a drinker cares about; flagging them
 *              spends the person's attention on nothing.
 *   3–7 years  the plain caveat: same producer, different year.
 *   8+ years   the gap gets named, because a decade is a different growing
 *              season, different fruit and often a different winemaker. This
 *              wording says the true thing without implying we got it wrong.
 */
export type ApproxVintage = {
  /** The year printed on the list. */
  scanned: number | null;
  /** The year of the bottle the score was actually computed from. */
  matched: number;
  /** Years between the two, when both are known. */
  gap: number | null;
};

/** Below this, an approximate vintage is not worth saying out loud. */
export const VINTAGE_CHIP_FLOOR = 2;
/** At or above this, the gap gets named. */
export const VINTAGE_CHIP_DISTANT = 8;

export type VintageTier = "clean" | "near" | "distant";

export function vintageTier(gap: number | null): VintageTier {
  // An unknown gap (no year on the list) can't be sized, so it takes the
  // middle wording — we can say which year we read, not how far off it is.
  if (gap == null) return "near";
  if (gap <= VINTAGE_CHIP_FLOOR) return "clean";
  return gap >= VINTAGE_CHIP_DISTANT ? "distant" : "near";
}

export function approxVintage(row: ScanRow): ApproxVintage | null {
  const s = row.ranked.scanned;
  if (!s?.vintage_approx) return null;
  if (s.matched_vintage == null) return null;
  const scanned = s.vintage ?? null;
  const gap = scanned != null ? Math.abs(scanned - s.matched_vintage) : null;
  // Tier 1: within two years, say nothing.
  if (vintageTier(gap) === "clean") return null;
  return { scanned, matched: s.matched_vintage, gap };
}

/** True when the score came from a year close enough to call it exact. */
export function isExactVintage(row: ScanRow): boolean {
  return approxVintage(row) == null;
}

/** Short chip, Call only. Sits at the same weight as "Estimated match". */
export function approxChipLabel(a: ApproxVintage): string {
  return `Scored off the ${a.matched}`;
}

/** The chip's expansion, and the quiet single line used on list rows. */
export function approxCaveat(a: ApproxVintage): string {
  if (a.scanned == null) {
    return `Scored off the ${a.matched} — the list didn't show a year. Same producer, different year.`;
  }
  if (vintageTier(a.gap) === "distant") {
    return `Scored off the ${a.matched} — ${a.gap} years off the ${a.scanned} on the list. Same house, a very different growing season.`;
  }
  return `Scored off the ${a.matched} — we don't have the ${a.scanned} yet. Same producer, different year.`;
}

/** The line that goes directly under the wine name: the year we scored, then the caveat. */
export function approxSubline(a: ApproxVintage): string {
  if (a.scanned == null) return `${a.matched} · the list didn't show a year`;
  if (vintageTier(a.gap) === "distant") return `${a.matched} · ${a.gap} years off the ${a.scanned}`;
  return `${a.matched} · we don't have the ${a.scanned} yet`;
}
