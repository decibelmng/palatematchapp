import type { ScanRow } from "./types";

export type Alternate = {
  row: ScanRow;
  kind: "spend-less" | "different-direction";
  label: string;
  reason: string;
};

function fpDistance(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

/**
 * Two structurally different alternates.
 *
 *   SPEND LESS         — highest predicted at ≥ 25% below the Call's price.
 *                        Omitted entirely if no such wine exists.
 *   DIFFERENT DIRECTION — highest predicted whose style is furthest from
 *                        the Call's fingerprint in Euclidean distance,
 *                        so bimodal palates see both poles.
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
      .sort((a, b) => b.predicted - a.predicted);
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

  // DIFFERENT DIRECTION — furthest fp from Call, still a decent match
  const callFp = call.ranked.bottle.fp as unknown as number[] | null;
  const remaining = others.filter((r) => !out.some((o) => o.row.key === r.key));
  const scored = remaining
    .map((r) => ({
      r,
      dist: fpDistance(callFp, r.ranked.bottle.fp as unknown as number[] | null),
    }))
    .filter((x) => x.dist > 0 && x.r.predicted >= 3.4)
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
  const a = call.ranked.bottle.fp as unknown as number[] | null;
  const b = other.ranked.bottle.fp as unknown as number[] | null;
  if (!a || !b || a.length < 4 || b.length < 4) {
    return "A different corner of your palate.";
  }
  // Axis order matches recommender fp layout: body, tannin, acidity, ripeness…
  // Report the biggest movement in plain language.
  const body = b[0] - a[0];
  const tannin = b[1] - a[1];
  const ripeness = (b[3] ?? 0) - (a[3] ?? 0);
  const biggest = [
    { d: Math.abs(body), phrase: body > 0 ? "Bolder and fuller." : "Lighter, more delicate." },
    { d: Math.abs(tannin), phrase: tannin > 0 ? "More structured and grippy." : "Silkier, less grip." },
    { d: Math.abs(ripeness), phrase: ripeness > 0 ? "Riper, more fruit-forward." : "Leaner, more savory." },
  ].sort((x, y) => y.d - x.d)[0];
  return biggest.phrase;
}
