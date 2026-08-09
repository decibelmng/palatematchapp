import type { ScanRow } from "./types";
import type { FpKey, FpVec } from "@/lib/recommender";

export type Alternate = {
  row: ScanRow;
  kind: "spend-less" | "different-direction";
  label: string;
  reason: string;
};

// Iterate the style vector in a fixed order. Never index a Record
// with numeric literals — that returns undefined and silently zeros distance.
const FP_ORDER: FpKey[] = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"];

function fpDistance(a: FpVec | null | undefined, b: FpVec | null | undefined): number {
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
/** An alternate is an alternate to the wine in hand. A $690 bottle is not an
 *  alternate to a $65 one, however different its style — so a different
 *  direction may not cost more than 2.5x the Call. */
const DIFFERENT_DIRECTION_PRICE_CEILING = 2.5;

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
      const pickAmt = pick.price_amount;
      const savingsPct = pickAmt && pickAmt > 0 ? Math.round((1 - pickAmt / callAmt) * 100) : 0;

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

  const ceiling = callAmt && callAmt > 0 ? callAmt * DIFFERENT_DIRECTION_PRICE_CEILING : null;
  const scored = remaining
    // A missing price abstains rather than being treated as affordable.
    .filter((r) => (ceiling == null ? true : r.price_amount == null || r.price_amount <= ceiling))
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

  // A missing axis is UNKNOWN. Substituting a 0.5 midpoint invents a difference
  // (or hides one) and can put a confident sensory claim on a wine we failed to
  // read — so an axis missing on either side simply does not compete.
  const diff = (k: "body" | "tannin" | "ripe" | "acid" | "oak"): number | null => {
    const av = a[k];
    const bv = b[k];
    if (av == null || bv == null || !Number.isFinite(av) || !Number.isFinite(bv)) return null;
    return bv - av;
  };
  const candidates = [
    { d: diff("body"), up: "Bolder and fuller.", down: "Lighter, more delicate." },
    { d: diff("tannin"), up: "More structured and grippy.", down: "Silkier, less grip." },
    { d: diff("ripe"), up: "Riper, more fruit-forward.", down: "Leaner, more savory." },
    { d: diff("acid"), up: "Sharper, higher-toned.", down: "Rounder, softer-edged." },
    { d: diff("oak"), up: "More oak-shaped.", down: "Cleaner, less oak." },
  ]
    .filter((c): c is { d: number; up: string; down: string } => c.d != null)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const top = candidates[0];
  if (!top) return "A different corner of your palate.";
  return top.d > 0 ? top.up : top.down;
}
