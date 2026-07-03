import { describe, it, expect } from "vitest";
import { recommend, type BottleFp, type RatedFp, type FpKey } from "@/lib/recommender";
import { computeCode, RED_AXES } from "@/lib/palate";
import { cuveeKey } from "@/lib/cuvee";

// ---------- helpers ----------

const AXES: FpKey[] = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"];

function fp(partial: Partial<Record<FpKey, number>> = {}): Record<FpKey, number> {
  const out = {} as Record<FpKey, number>;
  for (const k of AXES) out[k] = partial[k] ?? 0.5;
  return out;
}

function rated(
  id: string,
  stars: number,
  values: Partial<Record<FpKey, number>>,
  type: RatedFp["type"] = "red",
): RatedFp {
  return { id, name: id, producer: null, region: null, type, fp: fp(values), stars };
}

function cand(id: string, values: Partial<Record<FpKey, number>>, type: BottleFp["type"] = "red"): BottleFp {
  return { id, name: id, producer: null, region: null, type, fp: fp(values) };
}

// ---------- recommend() ----------

describe("recommend()", () => {
  it("predicts wide star spread for near vs far candidates (no compression)", () => {
    // 6 same-type ratings spanning 1..5, strongly correlated with `body`.
    const r: RatedFp[] = [
      rated("a", 5, { body: 0.95, tannin: 0.9 }),
      rated("b", 5, { body: 0.9, tannin: 0.85 }),
      rated("c", 4, { body: 0.8, tannin: 0.75 }),
      rated("d", 2, { body: 0.3, tannin: 0.3 }),
      rated("e", 1, { body: 0.15, tannin: 0.2 }),
      rated("f", 1, { body: 0.1, tannin: 0.15 }),
    ];
    const near = cand("near", { body: 0.92, tannin: 0.88 });
    const far = cand("far", { body: 0.12, tannin: 0.17 });
    const recs = recommend(r, [near, far]);
    const nearRec = recs.find((x) => x.bottle.id === "near")!;
    const farRec = recs.find((x) => x.bottle.id === "far")!;
    expect(nearRec.predicted - farRec.predicted).toBeGreaterThanOrEqual(1.0);
  });

  it("excludes candidates of unrated types when restrictToRatedTypes is true", () => {
    const r: RatedFp[] = [rated("a", 4, { body: 0.6 }, "red"), rated("b", 5, { body: 0.7 }, "red")];
    const white = cand("w", { body: 0.6 }, "white");
    const red = cand("rc", { body: 0.6 }, "red");
    const recs = recommend(r, [white, red]);
    expect(recs.map((x) => x.bottle.id)).toEqual(["rc"]);
  });

  it("gives higher confidence to a candidate near many rated wines than a distant one", () => {
    const r: RatedFp[] = [
      rated("a", 5, { body: 0.9, acid: 0.85 }),
      rated("b", 4, { body: 0.88, acid: 0.8 }),
      rated("c", 4, { body: 0.85, acid: 0.82 }),
      rated("d", 3, { body: 0.5, acid: 0.5 }),
    ];
    const near = cand("near", { body: 0.88, acid: 0.83 });
    const far = cand("far", { body: 0.05, acid: 0.05 });
    const recs = recommend(r, [near, far]);
    const nearRec = recs.find((x) => x.bottle.id === "near")!;
    const farRec = recs.find((x) => x.bottle.id === "far")!;
    expect(nearRec.confidence).toBeGreaterThan(farRec.confidence);
  });
});

// ---------- computeCode() ----------

describe("computeCode()", () => {
  it("returns 'N' + 'loves both poles' when loved wines sit at both poles of an axis", () => {
    const rows = [
      { stars: 5, values: { body: 0.05, fruit_char: 0.5, tannin: 0.5, acidity: 0.5, sweet: 0 } },
      { stars: 5, values: { body: 0.95, fruit_char: 0.5, tannin: 0.5, acidity: 0.5, sweet: 0 } },
      { stars: 5, values: { body: 0.08, fruit_char: 0.5, tannin: 0.5, acidity: 0.5, sweet: 0 } },
      { stars: 5, values: { body: 0.92, fruit_char: 0.5, tannin: 0.5, acidity: 0.5, sweet: 0 } },
    ];
    const { letters } = computeCode(rows, RED_AXES);
    const body = letters.find((l) => l.axis === "body")!;
    expect(body.bimodal).toBe(true);
    expect(body.letter).toBe("N");
    expect(body.descriptor).toBe("loves both poles");
  });

  it("locks Sweet to 'D' when all rated wines sit at the dry floor", () => {
    const rows = [
      { stars: 5, values: { body: 0.5, fruit_char: 0.5, tannin: 0.5, acidity: 0.5, sweet: 0 } },
      { stars: 4, values: { body: 0.5, fruit_char: 0.5, tannin: 0.5, acidity: 0.5, sweet: 0.05 } },
      { stars: 3, values: { body: 0.5, fruit_char: 0.5, tannin: 0.5, acidity: 0.5, sweet: 0.08 } },
    ];
    const { letters } = computeCode(rows, RED_AXES);
    const sweet = letters.find((l) => l.axis === "sweet")!;
    expect(sweet.letter).toBe("D");
    expect(sweet.resolved).toBe(true);
  });

  it("1–2★ ratings contribute zero weight (single 2★ leaves axis unresolved)", () => {
    const rows = [
      { stars: 2, values: { body: 0.9, fruit_char: 0.9, tannin: 0.9, acidity: 0.9, sweet: 0.9 } },
      { stars: 1, values: { body: 0.1, fruit_char: 0.1, tannin: 0.1, acidity: 0.1, sweet: 0.9 } },
    ];
    const { letters } = computeCode(rows, RED_AXES);
    for (const l of letters) {
      expect(l.resolved).toBe(false);
      expect(l.letter).toBe("·");
    }
  });
});

// ---------- cuveeKey() ----------

describe("cuveeKey()", () => {
  it("collapses different vintages of the same wine into one cuvée", () => {
    const a = cuveeKey({ producer: "Produttori del Barbaresco", name: "Barbaresco 2018", region: "Piedmont", type: "red" });
    const b = cuveeKey({ producer: "Produttori del Barbaresco", name: "Barbaresco 2019", region: "Piedmont", type: "red" });
    expect(a).toEqual(b);
  });

  it("does NOT collapse different cuvées from the same producer", () => {
    const barbaresco = cuveeKey({ producer: "Produttori del Barbaresco", name: "Barbaresco", region: "Piedmont", type: "red" });
    const bricTurot = cuveeKey({ producer: "Produttori del Barbaresco", name: "Barbaresco Riserva Bric Turot", region: "Piedmont", type: "red" });
    expect(barbaresco).not.toEqual(bricTurot);
  });

  it("normalizes accents and drops stopwords", () => {
    const a = cuveeKey({ producer: "Château Margaux", name: "Château Margaux", region: "Bordeaux", type: "red" });
    const b = cuveeKey({ producer: "Chateau Margaux", name: "the Chateau Margaux", region: "bordeaux", type: "red" });
    expect(a).toEqual(b);
  });
});
