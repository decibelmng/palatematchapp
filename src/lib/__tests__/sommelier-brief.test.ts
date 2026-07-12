import { describe, it, expect } from "vitest";
import {
  buildTypeBrief,
  buildFullBrief,
  type BriefBenchmark,
  type TypeBriefInputs,
} from "@/lib/sommelier-brief";
import type { FpKey, RatedFp } from "@/lib/recommender";
import type { RatedBottle } from "@/lib/palate";

const AXES: FpKey[] = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"];

function fp(partial: Partial<Record<FpKey, number>> = {}): Record<FpKey, number> {
  const out = {} as Record<FpKey, number>;
  for (const k of AXES) out[k] = partial[k] ?? 0.5;
  return out;
}

function ratedFp(
  id: string,
  stars: number,
  values: Partial<Record<FpKey, number>> = {},
  extras: Partial<Pick<RatedFp, "canon" | "nemesis" | "producer" | "region" | "name">> = {},
): RatedFp {
  return {
    id,
    name: extras.name ?? id,
    producer: extras.producer ?? null,
    region: extras.region ?? null,
    type: "red",
    fp: fp(values),
    stars,
    canon: extras.canon,
    nemesis: extras.nemesis,
  };
}

function ratedRed(stars: number, values: Partial<Record<string, number>>, canon = false): RatedBottle {
  return {
    stars,
    canon,
    values: {
      body: values.body ?? 0.5,
      fruit_char: values.fruit_char ?? 0.5,
      tannin: values.tannin ?? 0.5,
      acidity: values.acidity ?? 0.5,
      sweet: values.sweet ?? 0.05,
    },
  };
}

function bench(
  id: string,
  values: Partial<Record<FpKey, number>>,
  meta: { name: string; producer?: string; region?: string; createdAt?: string },
): BriefBenchmark {
  return {
    id,
    bottleId: id,
    name: meta.name,
    producer: meta.producer ?? null,
    region: meta.region ?? null,
    fp: fp(values),
    createdAt: meta.createdAt ?? "2026-01-01T00:00:00Z",
  };
}

describe("buildTypeBrief — single-type user", () => {
  it("returns a single paragraph with all four content moves", () => {
    // 5 loved silky reds + 5 loved grippy reds → bimodal tannin/fruit
    const rated: RatedBottle[] = [];
    for (let i = 0; i < 5; i++) rated.push(ratedRed(5, { tannin: 0.2, fruit_char: 0.3, body: 0.35 }, true));
    for (let i = 0; i < 5; i++) rated.push(ratedRed(5, { tannin: 0.85, fruit_char: 0.8, body: 0.85 }, true));
    rated.push(ratedRed(1, { tannin: 0.9, fruit_char: 0.95 })); // a nemesis-style dislike

    const ratedFpAll: RatedFp[] = [];
    for (let i = 0; i < 5; i++) ratedFpAll.push(ratedFp(`silky-${i}`, 5, { tannin: 0.2, fruit_dark: 0.3, body: 0.35, acid: 0.7, fresh: 0.7 }, { canon: i === 0 }));
    for (let i = 0; i < 5; i++) ratedFpAll.push(ratedFp(`grippy-${i}`, 5, { tannin: 0.85, fruit_dark: 0.8, body: 0.85, acid: 0.6, oak: 0.7 }, { canon: i === 0 }));
    ratedFpAll.push(ratedFp("neme-1", 1, { tannin: 0.9, fruit_dark: 0.95, ripe: 0.95 }, { nemesis: true }));

    const canons: BriefBenchmark[] = [
      bench("c-vosne", { tannin: 0.2, fruit_dark: 0.3, body: 0.35, acid: 0.7 }, { name: "Vosne-Romanée VV", producer: "Alex Gambal", region: "Vosne-Romanée", createdAt: "2026-05-01" }),
      bench("c-shafer", { tannin: 0.85, fruit_dark: 0.8, body: 0.85, oak: 0.7 }, { name: "Hillside Select", producer: "Shafer", region: "Napa", createdAt: "2026-04-01" }),
    ];
    const nemeses: BriefBenchmark[] = [
      bench("n-lodi", { tannin: 0.75, fruit_dark: 0.95, ripe: 0.95, oak: 0.7 }, { name: "Old Vine Zinfandel", producer: "Lodi Producer", region: "Lodi", createdAt: "2026-03-01" }),
    ];

    const input: TypeBriefInputs = { type: "red", rated, ratedFp: ratedFpAll, canons, nemeses };
    const brief = buildTypeBrief(input);
    expect(brief).not.toBeNull();
    const t = brief!.text;
    // Bimodal → two-style sentence
    expect(t.toLowerCase()).toMatch(/two distinct styles/);
    // Benchmarks appear
    expect(t).toMatch(/Benchmarks I love:/);
    expect(t).toMatch(/Vosne/);
    expect(t).toMatch(/Shafer/);
    // Dealbreakers
    expect(t).toMatch(/Please steer me away from:/);
    expect(t.toLowerCase()).toMatch(/lodi/);
    // Type label
    expect(t).toMatch(/^Reds: /);
    // No app jargon
    expect(t.toLowerCase()).not.toMatch(/canon|nemesis|palate code|★|\bx\b glyph/);
  });

  it("single-paragraph brief for a user with only one type ≥4 ratings", () => {
    const rated: RatedBottle[] = [
      ratedRed(5, { tannin: 0.3, fruit_char: 0.4, body: 0.35 }),
      ratedRed(4, { tannin: 0.25, fruit_char: 0.4, body: 0.3 }),
      ratedRed(4, { tannin: 0.3, fruit_char: 0.35, body: 0.35 }),
      ratedRed(5, { tannin: 0.28, fruit_char: 0.42, body: 0.36 }),
    ];
    const ratedFpAll: RatedFp[] = rated.map((r, i) => ratedFp(`r-${i}`, r.stars, { tannin: r.values.tannin, fruit_dark: r.values.fruit_char, body: r.values.body }));
    const input: TypeBriefInputs = { type: "red", rated, ratedFp: ratedFpAll, canons: [], nemeses: [] };
    const full = buildFullBrief({ red: input, white: null });
    expect(full.paragraphs.length).toBe(1);
    expect(full.text).toMatch(/^Reds: /);
    expect(full.text).toMatch(/My palate profile via Palate Match/);
  });

  it("returns null for a type below the minimum ratings threshold", () => {
    const rated: RatedBottle[] = [ratedRed(5, { tannin: 0.3 }), ratedRed(4, { tannin: 0.3 })];
    const ratedFpAll: RatedFp[] = rated.map((r, i) => ratedFp(`x-${i}`, r.stars, {}));
    const brief = buildTypeBrief({ type: "red", rated, ratedFp: ratedFpAll, canons: [], nemeses: [] });
    expect(brief).toBeNull();
  });

  it("stays under 120 words for a fully-populated two-type user", () => {
    const rated: RatedBottle[] = [];
    for (let i = 0; i < 8; i++) rated.push(ratedRed(5, { tannin: 0.2, fruit_char: 0.3 }, true));
    for (let i = 0; i < 8; i++) rated.push(ratedRed(5, { tannin: 0.85, fruit_char: 0.8 }, true));
    const ratedFpAll: RatedFp[] = rated.map((r, i) => ratedFp(`r-${i}`, r.stars, {}));
    const canons: BriefBenchmark[] = Array.from({ length: 6 }, (_, i) => bench(`c-${i}`, {}, { name: `Wine ${i}`, producer: `Producer ${i}` }));
    const nemeses: BriefBenchmark[] = [bench("n-1", { ripe: 0.9 }, { name: "Zin", producer: "Somewhere", region: "Lodi" })];
    const red: TypeBriefInputs = { type: "red", rated, ratedFp: ratedFpAll, canons, nemeses };
    const white: TypeBriefInputs = { type: "white", rated, ratedFp: ratedFpAll, canons, nemeses };
    const full = buildFullBrief({ red, white });
    expect(full.wordCount).toBeLessThanOrEqual(120);
  });

  it("Vosne (silky, high-acid) cluster never described as 'soft'", () => {
    const rated: RatedBottle[] = [];
    for (let i = 0; i < 6; i++) rated.push(ratedRed(5, { tannin: 0.2, fruit_char: 0.3, body: 0.35, acidity: 0.75 }, true));

    const ratedFpAll: RatedFp[] = [];
    for (let i = 0; i < 6; i++) ratedFpAll.push(ratedFp(`vosne-${i}`, 5, { tannin: 0.2, fruit_dark: 0.3, body: 0.35, acid: 0.75, fresh: 0.75 }, { canon: i === 0 }));

    const canons: BriefBenchmark[] = [
      bench("vosne-0", { tannin: 0.2, fruit_dark: 0.3, body: 0.35, acid: 0.75, fresh: 0.75 }, { name: "Vosne-Romanée VV", producer: "Alex Gambal", region: "Vosne-Romanée" }),
    ];
    const brief = buildTypeBrief({ type: "red", rated, ratedFp: ratedFpAll, canons, nemeses: [] });
    expect(brief).not.toBeNull();
    const t = brief!.text.toLowerCase();
    expect(t).not.toContain("soft");
    expect(t).toMatch(/silky|perfumed|red-fruited/);
  });

  it("emits one benchmark per style lane (up to cap of 5)", () => {
    const rated: RatedBottle[] = [];
    for (let i = 0; i < 4; i++) rated.push(ratedRed(5, { tannin: 0.2, fruit_char: 0.3, body: 0.35 }, true));
    for (let i = 0; i < 4; i++) rated.push(ratedRed(5, { tannin: 0.75, fruit_char: 0.55, body: 0.65 }, true));
    for (let i = 0; i < 4; i++) rated.push(ratedRed(5, { tannin: 0.9, fruit_char: 0.9, body: 0.95 }, true));

    const ratedFpAll: RatedFp[] = [];
    for (let i = 0; i < 4; i++) ratedFpAll.push(ratedFp(`pinot-${i}`, 5, { tannin: 0.2, fruit_dark: 0.3, body: 0.35, acid: 0.75 }, { canon: i === 0 }));
    for (let i = 0; i < 4; i++) ratedFpAll.push(ratedFp(`bdx-${i}`, 5, { tannin: 0.75, fruit_dark: 0.55, body: 0.65, oak: 0.5 }, { canon: i === 0 }));
    for (let i = 0; i < 4; i++) ratedFpAll.push(ratedFp(`napa-${i}`, 5, { tannin: 0.9, fruit_dark: 0.9, body: 0.95, oak: 0.8, ripe: 0.8 }, { canon: i === 0 }));

    const canons: BriefBenchmark[] = [
      bench("pinot-0", { tannin: 0.2, fruit_dark: 0.3, body: 0.35, acid: 0.75 }, { name: "Vosne-Romanée", producer: "Gambal", region: "Vosne" }),
      bench("bdx-0", { tannin: 0.75, fruit_dark: 0.55, body: 0.65, oak: 0.5 }, { name: "Clos Fourtet", producer: "Clos Fourtet", region: "St-Émilion" }),
      bench("napa-0", { tannin: 0.9, fruit_dark: 0.9, body: 0.95, oak: 0.8, ripe: 0.8 }, { name: "Hillside Select", producer: "Shafer", region: "Napa" }),
    ];
    const brief = buildTypeBrief({ type: "red", rated, ratedFp: ratedFpAll, canons, nemeses: [] });
    expect(brief).not.toBeNull();
    const t = brief!.text;
    expect(t).toMatch(/Vosne/);
    expect(t).toMatch(/Fourtet/);
    expect(t).toMatch(/Shafer/);
  });

  it("omega line uses directional 'without X' phrasing when nemesis pushes further", () => {
    const rated: RatedBottle[] = [];
    for (let i = 0; i < 6; i++) rated.push(ratedRed(5, { tannin: 0.65, fruit_char: 0.6, body: 0.6, acidity: 0.6 }, true));
    const ratedFpAll: RatedFp[] = [];
    for (let i = 0; i < 6; i++) ratedFpAll.push(ratedFp(`r-${i}`, 5, { tannin: 0.65, fruit_dark: 0.6, body: 0.6, acid: 0.6, ripe: 0.6 }, { canon: i === 0 }));
    const canons: BriefBenchmark[] = [
      bench("c-1", { tannin: 0.65, fruit_dark: 0.6, body: 0.6, ripe: 0.6 }, { name: "Producer Wine", producer: "Producer", region: "Somewhere" }),
    ];
    const nemeses: BriefBenchmark[] = [
      bench("n-1", { tannin: 0.75, fruit_dark: 0.95, body: 0.95, ripe: 0.95, oak: 0.8 }, { name: "Overripe Zin", producer: "Lodi", region: "Lodi" }),
    ];
    const brief = buildTypeBrief({ type: "red", rated, ratedFp: ratedFpAll, canons, nemeses });
    expect(brief).not.toBeNull();
    const t = brief!.text.toLowerCase();
    expect(t).toMatch(/i want /);
    expect(t).toMatch(/without/);
  });
});
