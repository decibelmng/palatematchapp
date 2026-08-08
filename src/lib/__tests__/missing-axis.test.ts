import { describe, it, expect } from "vitest";
import { predictStars, fpOf, type FpRow } from "@/lib/predict-core";
import { omegaDistance, RAX, type FpVec, type FpKey } from "@/lib/recommender";

/**
 * These cases fail under BOTH pre-fix conventions:
 *   - null → 0    (the ax_fruit_char bug: an unread axis read as a real floor)
 *   - null → 0.5  (an unread axis indistinguishable from a real centre)
 * They pass only when a missing axis is EXCLUDED and the remaining axes are
 * rescaled by the weight of the axes actually compared.
 */
function row(id: string, over: Partial<FpRow> = {}): FpRow {
  return {
    id, name: `Wine ${id}`, producer: "P", region: "R", vintage: 2019, type: "red",
    fp_fresh: 0.4, fp_acid: 0.5, fp_tannin: 0.6, fp_fruit_dark: 0.5,
    fp_ripe: 0.5, fp_oak: 0.4, fp_body: 0.6, fp_savory: 0.4,
    ...over,
  };
}

// Ratings spread along ripe so the axis carries real signal: low ripe loved,
// high ripe disliked. A candidate whose ripe is UNREAD must not inherit either.
// Deliberately asymmetric so no accidental symmetry can make two different
// conventions agree.
const rated = [
  { bottle: row("a", { fp_ripe: 0.05, fp_tannin: 0.3 }), stars: 5 },
  { bottle: row("b", { fp_ripe: 0.35, fp_tannin: 0.4 }), stars: 4 },
  { bottle: row("c", { fp_ripe: 0.8, fp_tannin: 0.55 }), stars: 2 },
  { bottle: row("d", { fp_ripe: 0.95, fp_tannin: 0.6 }), stars: 1 },
];

describe("missing-axis convention", () => {
  it("omits an unread axis from the style reading instead of substituting a value", () => {
    const fp = fpOf(row("t", { fp_ripe: null }));
    expect("ripe" in fp).toBe(false);
    expect(Object.keys(fp)).toHaveLength(7);
    // And it is not silently 0 or 0.5 under a different name.
    expect(Object.values(fp).every((v) => Number.isFinite(v))).toBe(true);
  });

  it("does not score an unread axis as though the wine sat at that axis's floor", () => {
    const unread = predictStars(rated, row("t", { fp_ripe: null }));
    const atFloor = predictStars(rated, row("t", { fp_ripe: 0 }));
    expect(unread.predicted).not.toBeNull();
    expect(atFloor.predicted).not.toBeNull();
    // Under the null→0 convention these are byte-identical.
    expect(unread.predicted).not.toBeCloseTo(atFloor.predicted as number, 6);
  });

  it("does not score an unread axis identically to a wine genuinely at 0.5 there", () => {
    const unread = predictStars(rated, row("t", { fp_ripe: null }));
    const atMid = predictStars(rated, row("t", { fp_ripe: 0.5 }));
    // Under the null→0.5 convention these are byte-identical.
    expect(unread.predicted).not.toBeCloseTo(atMid.predicted as number, 6);
  });

  it("gains no advantage and takes no penalty purely from the omission", () => {
    // Distance is the omega-weighted MEAN square over the axes both sides
    // carry, rescaled by the weight of those axes only:
    //     d = sqrt( sum_shared w*delta^2 / sum_shared w )
    // That is what makes 6-of-8 comparable to 8-of-8: the denominator counts
    // only what was compared, so the result is a per-axis average, not a sum
    // that shrinks every time an axis drops out.
    const omega = Object.fromEntries(RAX.map((k) => [k, 1])) as Record<FpKey, number>;
    const active = [...RAX];
    const base = Object.fromEntries(RAX.map((k) => [k, 0.5])) as FpVec;
    const offFull = Object.fromEntries(RAX.map((k) => [k, 0.6])) as FpVec;
    const offPartial = { ...offFull };
    delete offPartial.ripe;
    const basePartial = { ...base };
    delete basePartial.ripe;

    const dFull = omegaDistance(base, offFull, omega, active);
    const dPartial = omegaDistance(base, offPartial, omega, active);
    expect(dFull).toBeCloseTo(0.1, 10);
    // Identical per-axis average: the omission neither shortens nor lengthens.
    expect(dPartial).toBeCloseTo(dFull, 10);
    expect(omegaDistance(basePartial, offFull, omega, active)).toBeCloseTo(dFull, 10);

    // Under the old null-to-0 convention the omitted axis becomes a real 0.5
    // gap and the wine is pushed far away.
    const asFloor = { ...offFull, ripe: 0 } as FpVec;
    expect(omegaDistance(base, asFloor, omega, active)).toBeGreaterThan(dFull * 1.5);

    // No comparable axis at all is Infinity, never 0.
    expect(omegaDistance({ ripe: 0.2 }, { body: 0.2 }, omega, active)).toBe(Infinity);
  });
});
