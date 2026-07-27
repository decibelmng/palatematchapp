import type { ScanRow } from "./types";
import type { FpKey } from "@/lib/recommender";

export type Alternate = {
  row: ScanRow;
  kind: "spend-less" | "different-direction";
  label: string;
  reason: string;
};

// Iterate Record<FpKey, number> as an ordered vector. Never index a Record
// with numeric literals — that returns undefined and silently zeros distance.
const FP_ORDER: FpKey[] = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"];

function fpDistance(a: Record<FpKey, number> | null | undefined, b: Record<FpKey, number> | null | undefined): number {
  if (!a || !b) return 0;
  let s = 0;
  for (const k of FP_ORDER) {
    const d = (a[k] ?? 0) - (b[k] ?? 0);
    s += d * d;
  }
  return Math.sqrt(s);
}

/**
 * Two structurally different alternates.
 *
 *   SPEND LESS         — highest predicted at ≥ 25% below the Call's price.
 *                        Omitted entirely if no such wine exists.
 *   DIFFERENT DIRECTION — of wines that also score well on this palate
 *                        (top quartile of the list OR ≥ 3.8, whichever is
 *                        lower — the more permissive bar of the two), the
 *                        one whose fingerprint is furthest from the Call.
 *                        Omitted rather than surfacing a weird wine that
 *                        happens to be far away.
 */
export function pickAlternates(call: ScanRow, pool: ScanRow[]): Alternate[] {
  const out: Alternate[] = [];
  const others = pool.filter(
    (r) => r.key !== call.key && !r.ranked.vetoed && r.ranked.predicted > 0,
  );
  if (others.length === 0) return out;

  // SPEND LESS
  const callAmt = call.price_amount;
  if (callAmt && callAmt > 0) {
    const cutoff = callAmt * 0.75;
    const cheaper = others
      .filter((r) => r.price_amount && r.price_amount <= cutoff)
      .sort((a, b) => b.ranked.predicted - a.ranked.predicted);
    const pick = cheaper[0];
    if (pick) {
      const savingsPct = Math.round((1 - (pick.price_amount ?? 0) / callAmt) * 100);
      out.push({
        row: pick,
        kind: "spend-less",
        label: "Spend less",
        reason: `About ${savingsPct}% cheaper, still your style.`,
      });
    }
  }

  // DIFFERENT DIRECTION — constrained to real matches, not "the weirdest wine".
  const callFp = call.ranked.bottle.fp;
  const remaining = others.filter((r) => !out.some((o) => o.row.key === r.key));

  // Top-quartile floor across the ranked list (call included, cap included).
  const sortedScores = [call, ...others]
    .map((r) => r.ranked.predicted)
    .sort((a, b) => b - a);
  const qIdx = Math.max(0, Math.floor(sortedScores.length / 4) - 1);
  const topQuartileFloor = sortedScores[qIdx] ?? sortedScores[0];
  // "top quartile OR ≥ 3.8, whichever is lower" = the more permissive bar.
  const floor = Math.min(topQuartileFloor, 3.8);

  const scored = remaining
    .map((r) => ({ r, dist: fpDistance(callFp, r.ranked.bottle.fp) }))
    .filter((x) => x.dist > 0 && x.r.ranked.predicted >= floor)
    .sort((a, b) => b.dist - a.dist);
  const diff = scored[0]?.r;
  if (diff) {
    out.push({
      row: diff,
      kind: "different-direction",
      label: "Different direction",
      reason: contrastLine(call, diff),
    });
  }

  return out;
}

/** Short style-contrast phrase. Wine vocabulary, not axis names. */
function contrastLine(call: ScanRow, other: ScanRow): string {
  const a = call.ranked.bottle.fp;
  const b = other.ranked.bottle.fp;
  if (!a || !b) return "A different corner of your palate.";
  const body = (b.body ?? 0.5) - (a.body ?? 0.5);
  const tannin = (b.tannin ?? 0.5) - (a.tannin ?? 0.5);
  const ripeness = (b.ripe ?? 0.5) - (a.ripe ?? 0.5);
  const acid = (b.acid ?? 0.5) - (a.acid ?? 0.5);
  const oak = (b.oak ?? 0.5) - (a.oak ?? 0.5);
  const candidates = [
    { d: Math.abs(body), phrase: body > 0 ? "Bolder and fuller." : "Lighter, more delicate." },
    { d: Math.abs(tannin), phrase: tannin > 0 ? "More structured and grippy." : "Silkier, less grip." },
    { d: Math.abs(ripeness), phrase: ripeness > 0 ? "Riper, more fruit-forward." : "Leaner, more savory." },
    { d: Math.abs(acid), phrase: acid > 0 ? "Sharper, higher-toned." : "Rounder, softer-edged." },
    { d: Math.abs(oak), phrase: oak > 0 ? "More oak-shaped." : "Cleaner, less oak." },
  ].sort((x, y) => y.d - x.d);
  return candidates[0]?.phrase ?? "A different corner of your palate.";
}
