import { describe, it, expect } from "vitest";
import { seedRatedFpFor, SEED_FADE_THRESHOLD } from "@/lib/quiz-seeds";
import { recommend, type BottleFp, type FpKey, type RatedFp } from "@/lib/recommender";

const AXES: FpKey[] = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"];
function fp(p: Partial<Record<FpKey, number>> = {}) {
  const o = {} as Record<FpKey, number>;
  for (const k of AXES) o[k] = p[k] ?? 0.5;
  return o;
}
function rated(id: string, stars: number, v: Partial<Record<FpKey, number>>, type: RatedFp["type"] = "red"): RatedFp {
  return { id, name: id, producer: null, region: null, type, fp: fp(v), stars };
}
function cand(id: string, v: Partial<Record<FpKey, number>>, type: BottleFp["type"] = "red"): BottleFp {
  return { id, name: id, producer: null, region: null, type, fp: fp(v) };
}

describe("quiz seeds — cross-type isolation", () => {
  it("red-only quiz never seeds the white palate", () => {
    const answers = {
      type: "red" as const,
      votes: { "r-tannin": 1 as const, "r-body": 1 as const, "r-fruit-shade": 1 as const },
    };
    expect(seedRatedFpFor(answers, "red", 0)).toHaveLength(1);
    expect(seedRatedFpFor(answers, "white", 0)).toHaveLength(0);
  });

  it("white-only quiz never seeds the red palate", () => {
    const answers = {
      type: "white" as const,
      votes: { "w-oak": 1 as const, "w-acid": 1 as const },
    };
    expect(seedRatedFpFor(answers, "white", 0)).toHaveLength(1);
    expect(seedRatedFpFor(answers, "red", 0)).toHaveLength(0);
  });

  it("'both' produces two independent seed sets computed only from own-type votes", () => {
    const answers = {
      type: "both" as const,
      votes: {
        "r-tannin": 1 as const, "r-body": 1 as const,       // red pairs push tannin+body up
        "w-oak": -1 as const, "w-acid": 1 as const,          // white pairs push oak down, acid up
      },
    };
    const red = seedRatedFpFor(answers, "red", 0);
    const white = seedRatedFpFor(answers, "white", 0);
    expect(red).toHaveLength(1);
    expect(white).toHaveLength(1);
    // Red seed carries the red pair shifts, and no white-pair leakage.
    expect(red[0].fp.tannin).toBeGreaterThan(0.6);
    expect(red[0].fp.body).toBeGreaterThan(0.6);
    // White seed carries the white pair shifts. Oak was pushed low.
    expect(white[0].fp.oak).toBeLessThan(0.4);
    expect(white[0].fp.acid).toBeGreaterThan(0.6);
    // Cross-check: red-only pair ids never touch the white seed's tannin.
    // White seeds start neutral for tannin; red votes must not leak in.
    expect(white[0].fp.tannin).toBeCloseTo(0.5, 5);
  });

  it("seeds fade to zero once real ratings reach the threshold", () => {
    const answers = { type: "red" as const, votes: { "r-tannin": 1 as const } };
    expect(seedRatedFpFor(answers, "red", SEED_FADE_THRESHOLD - 1)).toHaveLength(1);
    expect(seedRatedFpFor(answers, "red", SEED_FADE_THRESHOLD)).toHaveLength(0);
  });
});

describe("quiz seeds — bimodality preservation", () => {
  it("a bimodal user resolves BOTH poles, not a midpoint", () => {
    // Loves at TWO separated poles + dislikes in the middle. Without the
    // sharpened kernel, the middle would smear into the average and this
    // test would fail.
    const real: RatedFp[] = [
      rated("silky1", 5, { body: 0.15, tannin: 0.15 }),
      rated("silky2", 5, { body: 0.18, tannin: 0.12 }),
      rated("silky3", 5, { body: 0.12, tannin: 0.20 }),
      rated("firm1", 5, { body: 0.90, tannin: 0.90 }),
      rated("firm2", 5, { body: 0.85, tannin: 0.92 }),
      rated("firm3", 5, { body: 0.92, tannin: 0.88 }),
      rated("mid1", 1, { body: 0.5, tannin: 0.5 }),
      rated("mid2", 1, { body: 0.48, tannin: 0.52 }),
    ];
    const answers = {
      type: "red" as const,
      votes: { "r-tannin": 1 as const, "r-body": 1 as const },
    };
    const seeds = seedRatedFpFor(answers, "red", real.length);
    // Past the fade threshold → empty. That is the design.
    expect(seeds).toHaveLength(0);

    const silkyCand = cand("c-silky", { body: 0.15, tannin: 0.15 });
    const firmCand = cand("c-firm", { body: 0.90, tannin: 0.90 });
    const midCand = cand("c-mid", { body: 0.5, tannin: 0.5 });
    const [silky, firm, mid] = recommend([...seeds, ...real], [silkyCand, firmCand, midCand]);

    // BOTH poles score high; the midpoint is clearly lower.
    expect(silky.predicted).toBeGreaterThan(4.0);
    expect(firm.predicted).toBeGreaterThan(4.0);
    expect(mid.predicted).toBeLessThan(Math.min(silky.predicted, firm.predicted) - 0.8);
  });

  it("under 5 real ratings, a single seed does not dominate the kernel", () => {
    // 4 real ratings — under the fade threshold, so seed is present.
    const real: RatedFp[] = [
      rated("firm1", 5, { body: 0.90, tannin: 0.90 }),
      rated("firm2", 5, { body: 0.85, tannin: 0.92 }),
      rated("silky1", 5, { body: 0.15, tannin: 0.15 }),
      rated("silky2", 5, { body: 0.18, tannin: 0.12 }),
    ];
    const answers = {
      type: "red" as const,
      votes: { "r-tannin": 1 as const, "r-body": 1 as const },
    };
    const seeds = seedRatedFpFor(answers, "red", real.length);
    expect(seeds).toHaveLength(1);
    // Linear fade: seedWeight = 1 - realCount/5. At 4 real ratings that is
    // 0.2, and share = 0.2 / (0.2 + 4) ≈ 4.8%. The seed is deliberately
    // small at this point — real ratings dominate long before the cliff.
    const seedWeight = seeds[0].weight ?? 1;
    const totalWeight = seedWeight + real.reduce((s, r) => s + (r.weight ?? 1), 0);
    expect(seedWeight).toBeCloseTo(0.2, 3);
    expect(seedWeight / totalWeight).toBeCloseTo(0.2 / 4.2, 3);

    // The silky pole must still resolve — a single unimodal seed at the firm
    // pole must not swallow the silky mode.
    const silkyCand = cand("c-silky", { body: 0.15, tannin: 0.15 });
    const [silky] = recommend([...seeds, ...real], [silkyCand]);
    expect(silky.predicted).toBeGreaterThan(4.0);
  });
});
