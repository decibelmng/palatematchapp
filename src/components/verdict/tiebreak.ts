import type { ScanRow } from "./types";

/**
 * Deterministic Call selection.
 *
 * When several wines sit within 0.1★ of the best score the screen must still
 * name ONE bottle — handing back "here are two, you decide" is exactly the work
 * the person came here to avoid.
 *
 * Order, confidence first and price genuinely last:
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

/** Rows within TIE★ of the best score, best first, ties broken above. */
export function tiedCandidates(eligible: ScanRow[]): ScanRow[] {
  if (eligible.length === 0) return [];
  const best = Math.max(...eligible.map((r) => r.ranked.predicted));
  return eligible
    .filter((r) => best - r.ranked.predicted <= TIE)
    .sort(compareCallCandidates);
}

export function pickCall(eligible: ScanRow[]): ScanRow | null {
  return tiedCandidates(eligible)[0] ?? null;
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

export type PricePosition = "bottom-third" | "middle" | "top-third" | "unknown";

/** Where the Call sits in the list's own price spread. Never absolute. */
export function pricePosition(call: ScanRow, rows: ScanRow[]): PricePosition {
  const mine = amount(call);
  if (mine == null) return "unknown";
  const priced = rows.map(amount).filter((a): a is number => a != null).sort((x, y) => x - y);
  if (priced.length < 3) return "unknown";
  const rank = priced.filter((a) => a < mine).length / priced.length;
  if (rank < 1 / 3) return "bottom-third";
  if (rank < 2 / 3) return "middle";
  return "top-third";
}
