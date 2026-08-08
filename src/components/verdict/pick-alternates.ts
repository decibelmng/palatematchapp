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
  let n = 0;
  for (const k of FP_ORDER) {
    // A missing axis is UNKNOWN, not 0 — coercing it to an axis endpoint
    // manufactures distance and can hand "Different direction" to a wine we
    // simply failed to read. Skip the axis and rescale over what we do have.
    const av = a[k];
    const bv = b[k];
    if (av == null || bv == null || !Number.isFinite(av) || !Number.isFinite(bv)) continue;
    const d = av - bv;
    s += d * d;
    n++;
  }
  if (n === 0) return 0;
  return Math.sqrt((s * FP_ORDER.length) / n);
}


/**
 * Two structurally different alternates.
 *
 *   SPEND LESS          — highest predicted at ≥ 25% below the Call's price.
 *                         Omitted entirely if no such wine exists.
 *   DIFFERENT DIRECTION — of wines with predicted ≥ 3.5, the one whose
 *                         fingerprint is furthest from the Call. Omitted
 *                         when no wine clears 3.5 — nothing else on the
 *                         list is worth calling an alternate. When the
 *                         pick lands more than 0.7★ below the Call, its
 *                         label softens to "A notch below your pick,
 *                         but a different style."
 */
const DIFFERENT_DIRECTION_FLOOR = 3.5;
const DIFFERENT_DIRECTION_SOFT_GAP = 0.7;

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

  // DIFFERENT DIRECTION — flat 3.5 floor across all lists. No quartile math.
  const callFp = call.ranked.bottle.fp;
  const remaining = others.filter((r) => !out.some((o) => o.row.key === r.key));

  const scored = remaining
    .map((r) => ({ r, dist: fpDistance(callFp, r.ranked.bottle.fp) }))
    .filter((x) => x.dist > 0 && x.r.ranked.predicted >= DIFFERENT_DIRECTION_FLOOR)
    .sort((a, b) => b.dist - a.dist);
  const diff = scored[0]?.r;
  if (diff) {
    const gap = call.ranked.predicted - diff.ranked.predicted;
    const label = gap > DIFFERENT_DIRECTION_SOFT_GAP
      ? "A notch below your pick, but a different style"
      : "Different direction";
    out.push({
      row: diff,
      kind: "different-direction",
      label,
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
