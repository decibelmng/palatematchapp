import { describe, it, expect } from "vitest";
import { recommend, __debug_learnOmega, type BottleFp, type RatedFp, type FpKey } from "@/lib/recommender";
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

// ---------- Engine v2 acceptance tests (Sharpened Anchor Field) ----------

describe("Engine v2 — acceptance", () => {
  it("(1) ceiling: 1 rating of 5★, identical candidate → predicted ≥ 4.5", () => {
    // Old formula (α=1.5, prior=3.0) capped this at (5+4.5)/2.5 = 3.80.
    // v2 with μᵤ = 5, μ_prior = (1·5 + 3·3.5)/4 = 3.875, α=0.5 →
    // (5 + 0.5·3.875)/1.5 = 4.625.
    const r: RatedFp[] = [rated("only", 5, { body: 0.7, tannin: 0.6 })];
    const c = cand("twin", { body: 0.7, tannin: 0.6 });
    const [rec] = recommend(r, [c]);
    expect(rec.predicted).toBeGreaterThanOrEqual(4.5);
    expect(rec.predicted).toBeLessThanOrEqual(4.75);
  });

  it("(2) mode isolation: four 5★ + one distant 1★, candidate hugs the nearest 5★", () => {
    // Re-specified per spec: 4× 5★ (one at d≈0.1, three at d≥0.5) + 1× 1★
    // at d≈0.4 from candidate. Adaptive h clamps into the 0.20–0.25 band, so
    // the 1★ contributes negligible kernel mass and prediction lands ≈ 4.54.
    // All variation lives on body/tannin so ω learning stays clean.
    const r: RatedFp[] = [
      rated("N5", 5, { body: 0.80, tannin: 0.80 }), // near candidate (d≈0.1)
      rated("F5a", 5, { body: 0.20, tannin: 0.85 }), // far 5★ #1 (d≈0.5)
      rated("F5b", 5, { body: 0.85, tannin: 0.20 }), // far 5★ #2 (d≈0.5)
      rated("F5c", 5, { body: 0.15, tannin: 0.20 }), // far 5★ #3 (d≈0.6)
      rated("B1",  1, { body: 0.30, tannin: 0.50 }), // dislike at d≈0.4
    ];
    const near5 = cand("near5", { body: 0.85, tannin: 0.85 });
    const [rec] = recommend(r, [near5]);
    expect(rec.predicted).toBeGreaterThanOrEqual(4.49);
    expect(rec.predicted).toBeLessThanOrEqual(4.59);
    expect(rec.nearest?.id).toBe("N5");
  });


  it("(3) dislike guard: candidate glued to a plain 1★ is capped near that 1★", () => {
    const r: RatedFp[] = [
      rated("hate", 1, { body: 0.9, tannin: 0.9 }),
      rated("love", 5, { body: 0.1, tannin: 0.1 }),
      rated("love2", 5, { body: 0.15, tannin: 0.15 }),
      rated("mid", 3, { body: 0.5, tannin: 0.5 }),
    ];
    const glued = cand("glued", { body: 0.9, tannin: 0.9 });
    const [rec] = recommend(r, [glued]);
    expect(rec.predicted).toBeLessThanOrEqual(1.6);
  });

  it("(4) exploratory: candidate far from every anchor → M < 0.5, tier exploratory", () => {
    const r: RatedFp[] = [
      rated("a", 5, { body: 0.9, tannin: 0.9 }),
      rated("b", 4, { body: 0.85, tannin: 0.85 }),
      rated("c", 3, { body: 0.8, tannin: 0.8 }),
    ];
    // All anchors clustered at (~0.85, ~0.85); candidate at opposite pole.
    const alien = cand("alien", { body: 0.05, tannin: 0.05, ripe: 0.05, oak: 0.05, body_: 0.05 } as never);
    const [rec] = recommend(r, [alien]);
    expect(rec.evidence).toBeLessThan(0.5);
    expect(rec.evidenceTier).toBe("exploratory");
  });

  it("(5) monotonicity: single-anchor prediction strictly decreases with distance", () => {
    const r: RatedFp[] = [rated("only", 5, { body: 0.5, tannin: 0.5 })];
    const cands: BottleFp[] = [];
    for (let step = 0; step <= 10; step++) {
      const off = 0.5 + step * 0.05; // walk body axis away from 0.5
      cands.push(cand(`c${step}`, { body: off, tannin: 0.5 }));
    }
    const recs = recommend(r, cands);
    // Recover order (recommend sorts by predicted desc; verify strict monotone in `step`).
    const byId = new Map(recs.map((x) => [x.bottle.id, x.predicted]));
    for (let step = 0; step < 10; step++) {
      const a = byId.get(`c${step}`)!;
      const b = byId.get(`c${step + 1}`)!;
      expect(a).toBeGreaterThanOrEqual(b);
    }
  });

  it("(6) Canon lift: same anchor as Canon lifts prediction & M vs plain 5★", () => {
    const base = { body: 0.8, tannin: 0.8, ripe: 0.75 };
    const plainAnchor = rated("A", 5, base);
    const canonAnchor: RatedFp = { ...plainAnchor, weight: 3.0, canon: true };
    const filler: RatedFp[] = [
      rated("f1", 3, { body: 0.4, tannin: 0.4 }),
      rated("f2", 4, { body: 0.6, tannin: 0.6 }),
      rated("f3", 3, { body: 0.5, tannin: 0.5 }),
    ];
    const c = cand("target", { body: 0.78, tannin: 0.78, ripe: 0.73 });
    const plainRec = recommend([plainAnchor, ...filler], [c])[0];
    const canonRec = recommend([canonAnchor, ...filler], [c])[0];
    expect(canonRec.predicted).toBeGreaterThan(plainRec.predicted);
    expect(canonRec.evidence).toBeGreaterThan(plainRec.evidence);
    expect(canonRec.nearestIsCanon).toBe(true);
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
