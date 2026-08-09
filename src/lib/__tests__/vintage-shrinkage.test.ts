import { describe, it, expect } from "vitest";
import {
  recommend,
  vintageGapPenalty,
  effectiveAlpha,
  PRIOR_ALPHA,
  type BottleFp,
  type RatedFp,
} from "@/lib/recommender";

/**
 * α-scaled shrinkage for vintage staleness.
 *
 * The claim under test: two candidates with IDENTICAL fingerprints and
 * therefore identical neighbour support must not score the same when one
 * reading came off the year in hand and the other came off a distant year.
 * The stale one sits closer to the person's per-type mean.
 */

const fp = { fresh: 0.8, acid: 0.7, tannin: 0.3, fruit_dark: 0.2, ripe: 0.25, oak: 0.2, body: 0.35, savory: 0.5 };

const rated: RatedFp[] = [
  { id: "r1", name: "Loved A", type: "red", fp, stars: 5 },
  { id: "r2", name: "Loved B", type: "red", fp: { ...fp, ripe: 0.3 }, stars: 5 },
  { id: "r3", name: "Middling", type: "red", fp: { ...fp, ripe: 0.9, body: 0.9 }, stars: 3 },
];

function cand(id: string, vintageGap: number | null): BottleFp {
  return { id, name: "Candidate", type: "red", fp: { ...fp, ripe: 0.28 }, vintageGap };
}

describe("g(gap) shape", () => {
  it("is flat at and below the two-year floor", () => {
    expect(vintageGapPenalty(0)).toBe(0);
    expect(vintageGapPenalty(1)).toBe(0);
    expect(vintageGapPenalty(2)).toBe(0);
  });

  it("rises monotonically through the middle", () => {
    const g = [3, 4, 5, 6, 7, 8, 10].map(vintageGapPenalty);
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeGreaterThan(g[i - 1]);
  });

  it("saturates — 25 years is not meaningfully worse than 15", () => {
    expect(vintageGapPenalty(25) - vintageGapPenalty(15)).toBeLessThan(0.07);
    expect(vintageGapPenalty(25)).toBeLessThanOrEqual(1);
  });

  it("treats an unknown gap as no claim of staleness", () => {
    expect(vintageGapPenalty(null)).toBe(0);
    expect(vintageGapPenalty(undefined)).toBe(0);
    expect(effectiveAlpha(cand("x", null))).toBe(PRIOR_ALPHA);
  });

  it("is sign-agnostic — an older match is as stale as a younger one", () => {
    expect(vintageGapPenalty(-9)).toBeCloseTo(vintageGapPenalty(9), 12);
  });
});

describe("α-scaled shrinkage", () => {
  it("shrinks an approximate-vintage candidate further toward the per-type mean", () => {
    const [exact] = recommend(rated, [cand("exact", null)]);
    const [approx] = recommend(rated, [cand("approx", 12)]);

    // Identical fingerprints ⇒ identical neighbour support. That is the point:
    // only the prior weight differs.
    expect(approx.evidence).toBeCloseTo(exact.evidence, 12);
    expect(approx.maxSimilarity).toBeCloseTo(exact.maxSimilarity, 12);

    // The neighbourhood is loved (5★), so the per-type mean sits BELOW the
    // kernel estimate and extra shrinkage must pull the score down.
    const typeMean = (5 + 5 + 3) / 3;
    expect(exact.predicted).toBeGreaterThan(typeMean);
    expect(approx.predicted).toBeLessThan(exact.predicted);
    expect(Math.abs(approx.predicted - typeMean)).toBeLessThan(
      Math.abs(exact.predicted - typeMean),
    );
  });

  it("leaves a two-year gap byte-identical to an exact match", () => {
    const [exact] = recommend(rated, [cand("exact", null)]);
    const [near] = recommend(rated, [cand("near", 2)]);
    expect(near.predicted).toBe(exact.predicted);
  });

  it("shrinks monotonically with the gap", () => {
    const preds = [null, 3, 6, 10, 20].map(
      (g) => recommend(rated, [cand(`c${g}`, g)])[0].predicted,
    );
    for (let i = 1; i < preds.length; i++) {
      expect(preds[i]).toBeLessThanOrEqual(preds[i - 1]);
    }
  });

  it("does not touch evidence tier — staleness is not thin support", () => {
    const [exact] = recommend(rated, [cand("exact", null)]);
    const [approx] = recommend(rated, [cand("approx", 20)]);
    expect(approx.evidenceTier).toBe(exact.evidenceTier);
  });
});
