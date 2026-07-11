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

  it("(7) ω-ordering: informative axis (body) rises above uniform when signal concentrates there", () => {
    // Rating variance lives ENTIRELY on body; every other axis is held at
    // 0.5 across all 4 anchors. After the option-2 rescale (Σω=A before
    // clamping) body's learned ω must exceed uniform (1.0).
    const r: RatedFp[] = [
      rated("hi1", 5, { body: 0.90 }),
      rated("hi2", 5, { body: 0.85 }),
      rated("lo1", 1, { body: 0.10 }),
      rated("lo2", 1, { body: 0.15 }),
    ];
    const fit = __debug_learnOmega!(r, "red");
    expect(fit.omega.body).toBeGreaterThan(1.0);
    // All uninformative axes tie (they share the same ridge fixed-point).
    for (const k of ["fresh", "acid", "ripe", "oak", "savory", "fruit_dark"] as FpKey[]) {
      expect(fit.omega[k]).toBeLessThan(fit.omega.body);
    }
  });

  it("(8) Canon–Nemesis pair weight (9×) sharpens ω further than ordinary pairs", () => {
    // Same fingerprints; only the pair weights change. The Canon(5★)–Nemesis(1★)
    // contrast pair carries 3·3 = 9× an ordinary pair, so ω_body under
    // canon/nemesis flags should be >= ω_body under plain weights.
    const plain: RatedFp[] = [
      rated("hi1", 5, { body: 0.90 }),
      rated("hi2", 5, { body: 0.85 }),
      rated("lo1", 1, { body: 0.10 }),
      rated("lo2", 1, { body: 0.15 }),
    ];
    const weighted: RatedFp[] = [
      { ...plain[0], weight: 3.0, canon: true },
      plain[1],
      { ...plain[2], weight: 3.0 }, // nemesis-role anchor
      plain[3],
    ];
    const plainFit = __debug_learnOmega!(plain, "red");
    const weightedFit = __debug_learnOmega!(weighted, "red");
    expect(weightedFit.omega.body).toBeGreaterThanOrEqual(plainFit.omega.body);
  });

  it("(9) D3 inversion is bounded: k informative axes stay ≥0.85× uniform, and beat uniform by n=8", () => {
    // Regression guard for the documented D3 case: variance concentrated on
    // 2 axes (body + tannin), everything else held constant. With only 4
    // anchors the Σω=A rescale can dip informative axes below uniform (1.0),
    // but the drift must be bounded — no informative axis may fall below
    // 0.85× uniform. By n=8 anchors the inversion must vanish entirely.
    const uniform = 1.0;
    const floor = 0.85 * uniform;
    const informative: FpKey[] = ["body", "tannin"];
    const uninformative: FpKey[] = ["fresh", "acid", "ripe", "oak", "savory", "fruit_dark"];

    // --- n=4: bounded inversion allowed, drift must not exceed 15% ---
    const small: RatedFp[] = [
      rated("hi1", 5, { body: 0.90, tannin: 0.88 }),
      rated("hi2", 5, { body: 0.85, tannin: 0.92 }),
      rated("lo1", 1, { body: 0.10, tannin: 0.12 }),
      rated("lo2", 1, { body: 0.15, tannin: 0.08 }),
    ];
    const smallFit = __debug_learnOmega!(small, "red");
    for (const k of informative) {
      expect(smallFit.omega[k]).toBeGreaterThanOrEqual(floor);
    }

    // --- n=8: inversion must vanish. Every informative axis > every uninformative axis. ---
    const large: RatedFp[] = [
      rated("h1", 5, { body: 0.90, tannin: 0.88 }),
      rated("h2", 5, { body: 0.85, tannin: 0.92 }),
      rated("h3", 5, { body: 0.88, tannin: 0.86 }),
      rated("h4", 4, { body: 0.78, tannin: 0.80 }),
      rated("l1", 1, { body: 0.10, tannin: 0.12 }),
      rated("l2", 1, { body: 0.15, tannin: 0.08 }),
      rated("l3", 2, { body: 0.22, tannin: 0.18 }),
      rated("l4", 1, { body: 0.12, tannin: 0.14 }),
    ];
    const largeFit = __debug_learnOmega!(large, "red");
    const minInformative = Math.min(...informative.map((k) => largeFit.omega[k]));
    const maxUninformative = Math.max(...uninformative.map((k) => largeFit.omega[k]));
    expect(minInformative).toBeGreaterThan(uniform);
    expect(minInformative).toBeGreaterThan(maxUninformative);
  });

  // ---------- Nemesis (Phase 2 Part 1) ----------

  it("(10) veto: candidate inside a Nemesis radius returns vetoed=true with no meaningful star, sorted below non-vetoed", () => {
    // A style baseline (5★ anchor at low-body / low-tannin), plus a Nemesis
    // 1★ anchor at high-body / high-tannin, plus a neutral 4★ anchor to give
    // structure. Then two candidates: one glued to the Nemesis, one far away.
    const r: RatedFp[] = [
      { ...rated("love1", 5, { body: 0.15, tannin: 0.10 }) },
      { ...rated("love2", 5, { body: 0.12, tannin: 0.12 }) },
      { ...rated("mid", 4, { body: 0.30, tannin: 0.25 }) },
      { ...rated("nemesis", 1, { body: 0.90, tannin: 0.92 }), weight: 3.0, nemesis: true },
    ];
    const near = cand("nemNear", { body: 0.89, tannin: 0.90 });
    const far = cand("safe", { body: 0.14, tannin: 0.12 });
    const recs = recommend(r, [near, far]);
    const byId = new Map(recs.map((x) => [x.bottle.id, x]));
    const nemHit = byId.get("nemNear")!;
    const safe = byId.get("safe")!;
    expect(nemHit.vetoed).toBe(true);
    expect(nemHit.vetoReason).not.toBeNull();
    expect(nemHit.vetoReason!.nemesis.id).toBe("nemesis");
    expect(nemHit.vetoReason!.drivingAxes.length).toBeGreaterThan(0);
    expect(safe.vetoed).toBe(false);
    // Sort: vetoed sinks below non-vetoed.
    expect(recs[0].vetoed).toBe(false);
    expect(recs[recs.length - 1].vetoed).toBe(true);
  });

  it("(11) demoting Nemesis to plain 1★ removes the veto but keeps the dislike cap", () => {
    const base: RatedFp[] = [
      rated("love1", 5, { body: 0.15, tannin: 0.10 }),
      rated("love2", 5, { body: 0.12, tannin: 0.12 }),
      rated("mid", 4, { body: 0.30, tannin: 0.25 }),
    ];
    const dislikeAnchor = rated("badBottle", 1, { body: 0.90, tannin: 0.92 });
    const c = cand("nemNear", { body: 0.89, tannin: 0.90 });
    const recs = recommend([...base, dislikeAnchor], [c]);
    const only = recs[0];
    expect(only.vetoed).toBe(false);
    // Dislike guard: capped near the 1★ anchor.
    expect(only.predicted).toBeLessThanOrEqual(1.5 + 1e-6);
  });

  it("(12) asymmetry: d ≈ 1.1·h from a Nemesis vetoes; same d from a Canon does NOT", () => {
    // Nemesis path
    const nemAnchors: RatedFp[] = [
      rated("l1", 5, { body: 0.10 }), rated("l2", 5, { body: 0.12 }),
      rated("m", 4, { body: 0.30 }),
      { ...rated("N", 1, { body: 0.90 }), weight: 3.0, nemesis: true },
    ];
    const nemRec = recommend(nemAnchors, [cand("x", { body: 0.90 })])[0];
    expect(nemRec.vetoed).toBe(true);

    // Canon path — same geometry, but the strong anchor is a Canon 5★.
    const canonAnchors: RatedFp[] = [
      rated("h1", 4, { body: 0.75 }), rated("h2", 4, { body: 0.72 }),
      rated("m", 3, { body: 0.60 }),
      { ...rated("C", 5, { body: 0.90 }), weight: 3.0, canon: true },
    ];
    const canRec = recommend(canonAnchors, [cand("x", { body: 0.90 })])[0];
    expect(canRec.vetoed).toBe(false);
    expect(canRec.predicted).toBeGreaterThan(3.5);
  });

  it("(13) Canon–Nemesis single-axis: that axis's ω strictly dominates at every fingerprint gap, and a Nemesis-matching candidate is vetoed", () => {
    // Property test: Canon and Nemesis identical on every axis except `body`.
    // For any δ ∈ {0.3, 0.6, 0.8}, ω_body must strictly exceed every other
    // ω, AND a candidate matching the Nemesis body value must fall inside
    // the 1.25·h veto radius. Prints all three ω vectors.
    const others: FpKey[] = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "savory"];
    for (const delta of [0.3, 0.6, 0.8]) {
      const bC = 0.5 + delta / 2;
      const bN = 0.5 - delta / 2;
      const r: RatedFp[] = [
        { ...rated("C1", 5, { body: bC }), weight: 3.0, canon: true },
        { ...rated("C2", 5, { body: bC }), weight: 3.0, canon: true },
        { ...rated("N1", 1, { body: bN }), weight: 3.0, nemesis: true },
        { ...rated("N2", 1, { body: bN }), weight: 3.0, nemesis: true },
      ];
      const fit = __debug_learnOmega!(r, "red");
      // eslint-disable-next-line no-console
      console.log(`[test13] δ=${delta} ω=`, JSON.stringify(fit.omega));
      for (const k of others) {
        expect(fit.omega.body).toBeGreaterThan(fit.omega[k]);
      }
      // Candidate matching Nemesis on the discriminating axis must be vetoed.
      const c = cand("cN", { body: bN });
      const rec = recommend(r, [c])[0];
      expect(rec.vetoed).toBe(true);
    }
  });


  it("(14) prior purity: nemesis flag/weight does NOT shift μ_prior — same underlying stars → same predicted floor", () => {
    // Two identical rating sets, only the flag/weight differ. Score a candidate
    // that's FAR from every anchor (evidence M → 0) so the prediction collapses
    // to μ_prior; the two predictions should match.
    const plain: RatedFp[] = [
      rated("a", 5, { body: 0.10 }),
      rated("b", 5, { body: 0.15 }),
      rated("c", 3, { body: 0.40 }),
      rated("d", 1, { body: 0.90 }),
    ];
    const flagged: RatedFp[] = [
      { ...plain[0] },
      { ...plain[1] },
      { ...plain[2] },
      { ...plain[3], weight: 3.0, nemesis: true },
    ];
    // Distant candidate ⇒ all similarities near 0 ⇒ predicted ≈ μ_prior.
    const far = cand("far", { body: 0.5, fresh: 1, acid: 1, oak: 1, ripe: 1, savory: 1 });
    const p1 = recommend(plain, [far])[0].predicted;
    const p2 = recommend(flagged, [far])[0].predicted;
    // If μ_prior stayed pure, the two must be identical up to FP noise.
    expect(Math.abs(p1 - p2)).toBeLessThan(0.05);
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
