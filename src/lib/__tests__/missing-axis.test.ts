import { describe, it, expect } from "vitest";
import { predictStars, fpOf, type FpRow } from "@/lib/predict-core";

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
const rated = [
  { bottle: row("a", { fp_ripe: 0.1, fp_tannin: 0.3 }), stars: 5 },
  { bottle: row("b", { fp_ripe: 0.9, fp_tannin: 0.8 }), stars: 1 },
  { bottle: row("c", { fp_ripe: 0.2, fp_tannin: 0.35 }), stars: 4 },
  { bottle: row("d", { fp_ripe: 0.8, fp_tannin: 0.75 }), stars: 2 },
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
    // Distance is ω-weighted mean-square over the SHARED axes, rescaled by the
    // weight of those axes only: d = sqrt(Σ_shared ω·Δ² / Σ_shared ω). So a
    // candidate identical to a rated wine on the 7 axes it can read scores the
    // same as one identical on all 8 — the missing axis neither pulls it closer
    // nor pushes it away. Under an unnormalised Σ ω·Δ² the 7-axis wine would be
    // systematically nearer everything; under a fixed /8 denominator it would
    // be systematically nearer too.
    const twin = { fp_ripe: 0.1, fp_tannin: 0.3, fp_body: 0.3 };
    const full = predictStars(rated, row("full", twin));
    const partial = predictStars(rated, row("partial", { ...twin, fp_ripe: null }));
    expect(full.predicted).not.toBeNull();
    expect(partial.predicted).not.toBeNull();
    // Same neighbourhood, same verdict: within a quarter star of each other,
    // and the omission does not make the partial wine the closer match.
    expect(Math.abs((partial.predicted as number) - (full.predicted as number))).toBeLessThan(0.25);
    expect(partial.predicted as number).toBeLessThanOrEqual((full.predicted as number) + 1e-9);
  });
});
