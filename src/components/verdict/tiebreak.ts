import { isThinRead, isAmbiguousJoinRead } from "@/lib/recommender";
import type { ScanRow } from "./types";
import { isExactVintage } from "./vintage";

/**
 * Deterministic Call selection.
 *
 * When several wines sit within 0.1★ of the best score the screen must still
 * name ONE bottle — handing back "here are two, you decide" is exactly the work
 * the person came here to avoid.
 *
 * Order, confidence first and price genuinely last:
 *   0. the year on the list beats a score taken off another year — knowing
 *      WHICH bottle we read outranks knowing it is in the catalog
 *   1. clean catalog match beats an estimated read
 *   2. closer to a wine you've actually rated (maxSimilarity)
 *   3. good-value verdict
 *   4. lower price
 *
 * Rules 1 and 2 are the same claim at different strengths, so they sit
 * together; price only separates wines we trust equally.
 *
 * A missing price is UNKNOWN, not high. If the price rule is reached and either
 * side has no readable amount, the rule abstains and the pair stays tied — we
 * do not penalise a wine for our own OCR failure.
 */
export const TIE = 0.1;

/**
 * maxSimilarity is continuous, so a raw comparison would decide every pair and
 * the value/price rules would be dead code. Differences below this are noise
 * from the same estimate and fall through.
 */
export const SIM_EPS = 0.01;

function amount(r: ScanRow): number | null {
  const a = r.price_amount;
  return a != null && Number.isFinite(a) && a > 0 ? a : null;
}

export function compareCallCandidates(a: ScanRow, b: ScanRow): number {
  // 0. Vintage: an exact-year read beats one derived from a different year.
  const ea = isExactVintage(a);
  const eb = isExactVintage(b);
  if (ea !== eb) return ea ? -1 : 1;

  // 1. Confidence: a clean catalog match beats an estimate.
  if (a.isCatalog !== b.isCatalog) return a.isCatalog ? -1 : 1;

  // 2. Confidence, weaker form: closer to a wine you've rated.
  const ds = (b.ranked.maxSimilarity ?? 0) - (a.ranked.maxSimilarity ?? 0);
  if (Math.abs(ds) > SIM_EPS) return ds;

  // 3. Value.
  if (a.greatValue !== b.greatValue) return a.greatValue ? -1 : 1;

  // 4. Price — abstains when either side is unknown.
  const pa = amount(a);
  const pb = amount(b);
  if (pa != null && pb != null && pa !== pb) return pa - pb;

  return 0;
}

/**
* A wine read on three or fewer style axes — or read from a review that may
 * describe a sibling bottle — can be ranked but must not be named as the Call — see THIN_READ_MAX_AXES. It stays in `eligible`, so it still
 * appears in the alternates and the full list; it is only removed from the
 * shortlist the single recommendation is drawn from. If EVERY candidate is a
 * thin read we do not refuse to answer: the screen still names one, because a
 * thin best guess beats no guess at a restaurant table.
 */
export function callEligible(eligible: ScanRow[]): ScanRow[] {
  const solid = eligible.filter(
    (r) => !isThinRead(r.ranked.bottle.fp, r.type) && !isAmbiguousJoinRead(r.ranked.bottle),
  );
  return solid.length > 0 ? solid : eligible;
}

/** Rows within TIE★ of the best score, best first, ties broken above. */
export function tiedCandidates(eligible: ScanRow[]): ScanRow[] {
  if (eligible.length === 0) return [];
  const best = Math.max(...eligible.map((r) => r.ranked.predicted));
  return eligible
    .filter((r) => best - r.ranked.predicted <= TIE)
    .sort(compareCallCandidates);
}

export function pickCall(eligible: ScanRow[]): ScanRow | null {
  return tiedCandidates(callEligible(eligible))[0] ?? null;
}

/**
 * One line for the detail sheet — never a card on the decision surface. The
 * point of resolving the tie is that the person should not have to.
 */
export function nearTieNote(row: ScanRow, eligible: ScanRow[]): string | null {
  const others = eligible.filter(
    (r) => r.key !== row.key && Math.abs(r.ranked.predicted - row.ranked.predicted) <= TIE,
  );
  if (others.length === 0) return null;
  if (others.length === 1) return `${others[0].ranked.bottle.name} scored within ${TIE.toFixed(1)} of this.`;
  return `${others.length} other wines on this list scored within ${TIE.toFixed(1)} of this.`;
}

export type PricePosition =
  | "bottom-third"
  | "middle"
  | "top-third"
  /** We could not read a price for the Call, or for any wine on the list. */
  | "unknown"
  /** Prices read fine, the list was too short for terciles to mean anything. */
  | "insufficient";

/**
 * Terciles over a handful of wines put one wine in each bucket regardless of the
 * actual spread — noise wearing the label of signal. Below this many PRICED
 * wines we decline to place the Call at all.
 */
export const PRICE_POSITION_MIN_PRICED = 8;

/**
 * Where the Call sits in the list's own price spread. Never absolute.
 *
 * "unknown" and "insufficient" are different facts and must stay distinguishable
 * in the data: the first is an OCR failure, the second a short list. Every row
 * also carries n_priced so the floor can be revisited from the data rather than
 * guessed at a second time.
 */
export function pricePosition(call: ScanRow, rows: ScanRow[]): PricePosition {
  const mine = amount(call);
  if (mine == null) return "unknown";
  const n = countPriced(rows);
  if (n === 0) return "unknown";
  if (n < PRICE_POSITION_MIN_PRICED) return "insufficient";
  const priced = rows.map(amount).filter((a): a is number => a != null).sort((x, y) => x - y);
  const rank = priced.filter((a) => a < mine).length / priced.length;
  if (rank < 1 / 3) return "bottom-third";
  if (rank < 2 / 3) return "middle";
  return "top-third";
}

/** How many wines on the list had a readable price. Logged on every row. */
export function countPriced(rows: ScanRow[]): number {
  return rows.reduce((n, r) => (amount(r) != null ? n + 1 : n), 0);
}
