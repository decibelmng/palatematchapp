import { describe, it, expect } from "vitest";
import { buildGuestQuickBrief } from "../somm-quick-brief";
import type { FpKey, RatedFp } from "../recommender";

const NEUTRAL: Record<FpKey, number> = {
  fresh: 0.5, acid: 0.5, tannin: 0.5, fruit_dark: 0.5, ripe: 0.5, oak: 0.5, body: 0.5, savory: 0.5,
};

const w = (
  name: string,
  type: "red" | "white",
  stars: number,
  fp: Partial<Record<FpKey, number>>,
  flags: { canon?: boolean; nemesis?: boolean } = {},
): RatedFp => ({
  id: name, name, producer: null, region: null, type,
  fp: { ...NEUTRAL, ...fp }, stars, canon: flags.canon, nemesis: flags.nemesis,
});

describe("buildGuestQuickBrief", () => {
  it("summarises a red palate with a sensory line and benchmark names", () => {
    const brief = buildGuestQuickBrief([
      w("Barolo", "red", 5, { tannin: 0.85, acid: 0.8 }, { canon: true }),
      w("Vosne-Romanée", "red", 5, { tannin: 0.2, acid: 0.75 }),
      w("Napa Cabernet", "red", 1, { ripe: 0.9 }, { nemesis: true }),
    ]);
    const red = brief.types.find((t) => t.type === "red")!;
    expect(red.ratedCount).toBe(3);
    // Sensory reflects the LOVED wines (4★+), not the disliked one.
    expect(red.sensory).toMatch(/^Leans /);
    expect(red.loves).toEqual(["Barolo"]);
    expect(red.avoids).toEqual(["Napa Cabernet"]);
  });

  it("omits a type the guest hasn't rated", () => {
    const brief = buildGuestQuickBrief([w("Chablis", "white", 5, { acid: 0.9 })]);
    expect(brief.types.map((t) => t.type)).toEqual(["white"]);
  });

  it("returns an empty brief for a guest with no ratings", () => {
    expect(buildGuestQuickBrief([]).types).toEqual([]);
  });

  it("never truncates a wine name and de-dupes benchmarks", () => {
    const brief = buildGuestQuickBrief([
      w("Château Margaux 2015", "red", 5, {}, { canon: true }),
      w("Château Margaux 2015", "red", 5, {}, { canon: true }),
    ]);
    expect(brief.types[0].loves).toEqual(["Château Margaux 2015"]);
  });
});
