import { describe, it, expect } from "vitest";
import { recommend, type BottleFp, type RatedFp, type FpKey } from "@/lib/recommender";
import { buildLanes, applyGlobalCap, type LaneItem } from "@/lib/lanes";

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
  extras: Partial<Pick<RatedFp, "canon" | "nemesis" | "weight" | "name">> = {},
): RatedFp {
  return {
    id,
    name: extras.name ?? id,
    producer: null,
    region: null,
    type: "red",
    fp: fp(values),
    stars,
    weight: extras.weight,
    canon: extras.canon,
    nemesis: extras.nemesis,
  };
}

function cand(id: string, values: Partial<Record<FpKey, number>>): BottleFp {
  return { id, name: id, producer: null, region: null, type: "red", fp: fp(values) };
}

/** Build lane items directly from recommender output. */
function itemsFromRecs(rows: RatedFp[], cands: BottleFp[]): LaneItem<{ id: string }>[] {
  return recommend(rows, cands).map((r) => ({
    predicted: r.predicted,
    maxSimilarity: r.maxSimilarity,
    nearestId: r.nearest?.id ?? null,
    vetoed: r.vetoed,
    payload: { id: r.bottle.id },
  }));
}

describe("buildLanes()", () => {
  it("no Canons → hasCanons=false, empty lanes", () => {
    const rows = [rated("r1", 4, { body: 0.8 }), rated("r2", 3, { body: 0.4 })];
    const items = itemsFromRecs(rows, [cand("c1", { body: 0.7 })]);
    const res = buildLanes(items, rows, "red");
    expect(res.hasCanons).toBe(false);
    expect(res.lanes).toEqual([]);
  });

  it("two Canons within h merge into one lane; label = higher weight", () => {
    // Two Canons sitting on top of each other (identical fp) plus a few
    // ordinary anchors to give the recommender enough pairs to fit ω.
    const rows: RatedFp[] = [
      rated("cA", 5, { body: 0.9, tannin: 0.9 }, { canon: true, weight: 3 }),
      rated("cB", 5, { body: 0.9, tannin: 0.9 }, { canon: true, weight: 3, name: "cB" }),
      rated("o1", 4, { body: 0.6 }),
      rated("o2", 2, { body: 0.3 }),
      rated("o3", 3, { body: 0.5 }),
    ];
    const items = itemsFromRecs(rows, [cand("cand-plush", { body: 0.85, tannin: 0.85 })]);
    const res = buildLanes(items, rows, "red");
    expect(res.hasCanons).toBe(true);
    expect(res.lanes.length).toBe(1);
    expect(res.lanes[0].memberCanons.length).toBe(2);
  });

  it("Canon with no candidate ≥ 4.0 → stub lane, no members shown", () => {
    // A Canon in one corner, all candidates in a distant corner and low-star.
    const rows: RatedFp[] = [
      rated("silky", 5, { body: 0.2, acid: 0.9, oak: 0.1 }, { canon: true, weight: 3 }),
      rated("plush", 5, { body: 0.9, tannin: 0.9 }, { canon: true, weight: 3 }),
      rated("dislike", 1, { body: 0.9, oak: 1.0 }),
      rated("mid", 3, { body: 0.6 }),
    ];
    // All candidates are plush-shaped → only the plush lane gets ≥4.
    const items = itemsFromRecs(rows, [
      cand("p1", { body: 0.88, tannin: 0.85 }),
      cand("p2", { body: 0.9, tannin: 0.88 }),
    ]);
    const res = buildLanes(items, rows, "red");
    const silky = res.lanes.find((l) => l.canonId === "silky");
    expect(silky?.isStub).toBe(true);
  });

  it("no candidate appears in two lanes", () => {
    const rows: RatedFp[] = [
      rated("A", 5, { body: 0.9 }, { canon: true, weight: 3 }),
      rated("B", 5, { body: 0.1 }, { canon: true, weight: 3 }),
      rated("o1", 4, { body: 0.5 }),
      rated("o2", 2, { body: 0.5 }),
    ];
    const items = itemsFromRecs(rows, [
      cand("x1", { body: 0.85 }),
      cand("x2", { body: 0.15 }),
      cand("x3", { body: 0.5 }),
    ]);
    const res = buildLanes(items, rows, "red");
    const seen = new Set<string>();
    for (const lane of res.lanes) {
      for (const m of lane.members) {
        expect(seen.has(m.payload.id)).toBe(false);
        seen.add(m.payload.id);
      }
    }
  });

  it("vetoed items never enter lanes", () => {
    const rows: RatedFp[] = [
      rated("canon", 5, { body: 0.9 }, { canon: true, weight: 3 }),
      rated("nem", 1, { body: 0.9, oak: 1.0 }, { nemesis: true, weight: 3 }),
      rated("mid", 3, { body: 0.5 }),
    ];
    const items = itemsFromRecs(rows, [cand("near-nem", { body: 0.9, oak: 0.99 })]);
    const res = buildLanes(items, rows, "red");
    const anyVetoed = res.lanes.some((l) => l.members.some((m) => m.vetoed));
    expect(anyVetoed).toBe(false);
  });

  it("applyGlobalCap trims from weakest lane's tail, never deletes a lane", () => {
    const lanes = [
      {
        clusterId: "A", canonId: "A", canonName: "A", canonRegion: null,
        canonFp: fp(), canonStars: 5, memberCanons: [], styleName: "A",
        isStub: false,
        members: Array.from({ length: 6 }, (_, i) => ({
          predicted: 4.9 - i * 0.01, maxSimilarity: 0.9,
          nearestId: "A", vetoed: false, payload: { id: `A${i}` },
        })),
      },
      {
        clusterId: "B", canonId: "B", canonName: "B", canonRegion: null,
        canonFp: fp(), canonStars: 5, memberCanons: [], styleName: "B",
        isStub: false,
        members: Array.from({ length: 6 }, (_, i) => ({
          predicted: 4.6 - i * 0.01, maxSimilarity: 0.8,
          nearestId: "B", vetoed: false, payload: { id: `B${i}` },
        })),
      },
    ];
    const capped = applyGlobalCap(lanes as any, 8, 8);
    const total = capped.reduce((s, l) => s + l.members.length, 0);
    expect(total).toBeLessThanOrEqual(8);
    // Both lanes still present with at least one member.
    expect(capped[0].members.length).toBeGreaterThan(0);
    expect(capped[1].members.length).toBeGreaterThan(0);
    // Weakest lane (B) shed more.
    expect(capped[0].members.length).toBeGreaterThanOrEqual(capped[1].members.length);
  });

  it("lane order: populated first by best predicted DESC; stubs last", () => {
    const rows: RatedFp[] = [
      rated("plush", 5, { body: 0.9, tannin: 0.9 }, { canon: true, weight: 3 }),
      rated("silky", 5, { body: 0.2, acid: 0.9 }, { canon: true, weight: 3 }),
      rated("mid", 3, { body: 0.5 }),
    ];
    const items = itemsFromRecs(rows, [
      cand("plush-cand", { body: 0.88, tannin: 0.85 }),
    ]);
    const res = buildLanes(items, rows, "red");
    // Plush lane populated, silky stub. Order: plush first, silky last.
    expect(res.lanes[0].canonId).toBe("plush");
    expect(res.lanes[res.lanes.length - 1].isStub).toBe(true);
  });
});
