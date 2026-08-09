import { describe, it, expect } from "vitest";
import { predictStars, predictStarsMany, type FpRow } from "@/lib/predict-core";

function row(id: string, over: Partial<FpRow> = {}): FpRow {
  return {
    id, name: `Wine ${id}`, producer: "P", region: "R", vintage: 2019, type: "red",
    fp_fresh: 0.4, fp_acid: 0.5, fp_tannin: 0.6, fp_fruit_dark: 0.5,
    fp_ripe: 0.5, fp_oak: 0.4, fp_body: 0.6, fp_savory: 0.4,
    ...over,
  };
}

const rated = [
  { bottle: row("a", { fp_tannin: 0.2, fp_body: 0.3 }), stars: 5 },
  { bottle: row("b", { fp_tannin: 0.9, fp_body: 0.9 }), stars: 2 },
  { bottle: row("c", { fp_tannin: 0.3, fp_body: 0.4 }), stars: 4 },
  { bottle: row("d", { fp_tannin: 0.8, fp_body: 0.8 }), stars: 1 },
];

describe("predict-core", () => {
  it("returns a prediction plus the model state that produced it", () => {
    const res = predictStars(rated, row("t", { fp_tannin: 0.25, fp_body: 0.35 }));
    expect(res.predicted).not.toBeNull();
    expect(res.nullReason).toBeNull();
    expect(res.bandwidth).toBeGreaterThan(0);
    expect(Object.keys(res.omega ?? {})).toContain("tannin");
    expect(res.nRated).toBe(4);
  });

  it("names the reason instead of returning a bare null", () => {
    const flat = row("t", {
      fp_fresh: 0, fp_acid: 0, fp_tannin: 0, fp_fruit_dark: 0,
      fp_ripe: 0, fp_oak: 0, fp_body: 0, fp_savory: 0,
    });
    expect(predictStars(rated, flat).nullReason).toBe("uncalibrated_bottle");

    // A missing fp_fresh is NOT uncalibrated. Reviewer prose addresses
    // freshness on ~15% of wines, so gating calibration on that one axis
    // refused to predict for most of the catalog. Any readable axis scores.
    expect(predictStars(rated, row("t", { fp_fresh: null })).nullReason).toBeNull();
    // Every axis absent, and never scored, still is.
    expect(
      predictStars(rated, row("t", {
        fp_fresh: null, fp_acid: null, fp_tannin: null, fp_fruit_dark: null,
        fp_ripe: null, fp_oak: null, fp_body: null, fp_savory: null,
      })).nullReason,
    ).toBe("uncalibrated_bottle");

    const white = row("w", { type: "white" });
    expect(predictStars(rated, white).nullReason).toBe("no_same_type_ratings");

    expect(predictStars(rated.slice(0, 2), row("t")).nullReason).toBe("too_few_ratings");
  });

  it("never blends colours: whites are scored only from white ratings", () => {
    const mixed = [...rated,
      { bottle: row("w1", { type: "white", fp_tannin: 0, fp_fruit_dark: 0, fp_acid: 0.9 }), stars: 5 },
      { bottle: row("w2", { type: "white", fp_tannin: 0, fp_fruit_dark: 0, fp_acid: 0.8 }), stars: 5 },
      { bottle: row("w3", { type: "white", fp_tannin: 0, fp_fruit_dark: 0, fp_acid: 0.7 }), stars: 4 },
    ];
    const target = row("wt", { type: "white", fp_tannin: 0, fp_fruit_dark: 0, fp_acid: 0.85 });
    const res = predictStars(mixed, target);
    // Three white ratings entered the fit, not seven.
    expect(res.nRated).toBe(3);
    expect(res.predicted!).toBeGreaterThan(4);
  });

  it("batch and single paths agree exactly", () => {
    const targets = [
      row("t1", { fp_tannin: 0.25, fp_body: 0.35 }),
      row("t2", { fp_tannin: 0.85, fp_body: 0.85 }),
      row("t3", { fp_tannin: 0.5, fp_body: 0.5 }),
    ];
    const many = predictStarsMany(rated, targets);
    for (const t of targets) {
      const one = predictStars(rated, t);
      expect(many.get(t.id)!.predicted).toBe(one.predicted);
      expect(many.get(t.id)!.bandwidth).toBe(one.bandwidth);
      expect(many.get(t.id)!.nRated).toBe(one.nRated);
    }
  });
});

describe("neighbor support", () => {
  it("counts rated wines within one bandwidth, and is null when no prediction was possible", () => {
    // A candidate sitting inside the low-tannin cluster stands on real evidence.
    const near = predictStars(rated, row("t", { fp_tannin: 0.25, fp_body: 0.35 }));
    expect(near.neighborSupport).not.toBeNull();
    expect(near.neighborSupport!).toBeGreaterThanOrEqual(1);
    expect(near.neighborSupport!).toBeLessThanOrEqual(rated.length);

    // No prediction => no support figure to report.
    const white = predictStars(rated, row("w", { type: "white" }));
    expect(white.predicted).toBeNull();
    expect(white.neighborSupport).toBeNull();
  });

  it("reports less support for a candidate extrapolated away from every rated wine", () => {
    const inCluster = predictStars(rated, row("t", { fp_tannin: 0.25, fp_body: 0.35 }));
    const far = predictStars(rated, row("t", {
      fp_tannin: 0.55, fp_body: 0.55, fp_fresh: 0.95, fp_oak: 0.95, fp_savory: 0.95,
    }));
    expect((far.neighborSupport ?? 0)).toBeLessThanOrEqual(inCluster.neighborSupport ?? 0);
  });
});

describe("axis deltas — the shape of a miss", () => {
  it("measures the candidate against the nearest wine the user actually loved", () => {
    // "a" (5★) and "c" (4★) are the loved wines; "b"/"d" are the low ratings.
    // A candidate parked on top of "c" should be measured against "c".
    const onC = predictStars(rated, row("t", { fp_tannin: 0.3, fp_body: 0.4 }));
    expect(onC.axisDeltas).not.toBeNull();
    expect(onC.axisDeltas!.anchor.id).toBe("c");
    expect(onC.axisDeltas!.anchor.stars).toBeGreaterThanOrEqual(4);
    // Identical wine => no difference on any axis.
    for (const v of Object.values(onC.axisDeltas!.axes)) expect(Math.abs(v)).toBeLessThan(1e-9);
  });

  it("signs the difference candidate-minus-loved-wine, so direction is readable", () => {
    // More tannin and more body than either loved wine => positive on both.
    const grippier = predictStars(rated, row("t", { fp_tannin: 0.7, fp_body: 0.75 }));
    expect(grippier.axisDeltas!.axes.tannin).toBeGreaterThan(0);
    expect(grippier.axisDeltas!.axes.body).toBeGreaterThan(0);

    const softer = predictStars(rated, row("t", { fp_tannin: 0.05, fp_body: 0.1 }));
    expect(softer.axisDeltas!.axes.tannin).toBeLessThan(0);
    expect(softer.axisDeltas!.axes.body).toBeLessThan(0);
  });

  it("is null when there is no loved wine of that colour to measure against", () => {
    const noLoves = [
      { bottle: row("b", { fp_tannin: 0.9, fp_body: 0.9 }), stars: 2 },
      { bottle: row("d", { fp_tannin: 0.8, fp_body: 0.8 }), stars: 1 },
      { bottle: row("e", { fp_tannin: 0.7, fp_body: 0.7 }), stars: 3 },
    ];
    const res = predictStars(noLoves, row("t", { fp_tannin: 0.3 }));
    expect(res.predicted).not.toBeNull();
    expect(res.axisDeltas).toBeNull();

    // And null wherever no prediction was possible at all.
    expect(predictStars(rated, row("w", { type: "white" })).axisDeltas).toBeNull();
  });

  it("batch and single paths report the same deltas", () => {
    const t = row("t", { fp_tannin: 0.45, fp_body: 0.5 });
    const many = predictStarsMany(rated, [t]).get("t")!;
    expect(many.axisDeltas).toEqual(predictStars(rated, t).axisDeltas);
  });
});
