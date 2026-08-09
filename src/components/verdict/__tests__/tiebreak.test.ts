import { describe, it, expect } from "vitest";
import type { ScanRow } from "../types";
import { compareCallCandidates, pickCall, callEligible, nearTieNote, pricePosition, countPriced } from "../tiebreak";

/** Minimal ScanRow good enough for the tie-break; everything else is unused. */
function row(o: {
  key: string;
  predicted: number;
  isCatalog?: boolean;
  sim?: number;
  greatValue?: boolean;
  price?: number | null;
  name?: string;
  /** Axis values present on the reading; omit for "no reading object". */
  fp?: Record<string, number> | null;
  type?: string;
  /** Set to mark the score as taken off a different year than the list showed. */
  approxFrom?: number;
}): ScanRow {
  return {
    key: o.key,
    ranked: {
      predicted: o.predicted,
      maxSimilarity: o.sim ?? 0.5,
      vetoed: false,
      bottle: { name: o.name ?? o.key, fp: o.fp ?? null },
      scanned: o.approxFrom == null
        ? { vintage: 2022, vintage_approx: false, matched_vintage: 2022 }
        : { vintage: 2022, vintage_approx: true, matched_vintage: o.approxFrom },
    },
    type: o.type ?? "red",
    isCatalog: o.isCatalog ?? true,
    greatValue: o.greatValue ?? false,
    price_amount: o.price === undefined ? 100 : o.price,
  } as unknown as ScanRow;
}

describe("tie-break — each rule in isolation", () => {
  it("0. an exact-vintage read beats an approximate one, ahead of catalog status", () => {
    // The approximate row wins every later rule; the vintage rule must still
    // decide, because a score taken off a 15-year-older bottle may not describe
    // the wine on the list at all.
    const exact = row({ key: "exact", predicted: 4.5, isCatalog: false, sim: 0.2, price: 300 });
    const approx = row({ key: "approx", predicted: 4.5, isCatalog: true, sim: 0.9, greatValue: true, price: 20, approxFrom: 2007 });
    expect(compareCallCandidates(exact, approx)).toBeLessThan(0);
    expect(pickCall([approx, exact])!.key).toBe("exact");
  });

  it("1. isCatalog wins first, even when the estimate is cheaper, better value and closer", () => {
    const catalog = row({ key: "cat", predicted: 4.5, isCatalog: true, sim: 0.2, greatValue: false, price: 200 });
    const estimate = row({ key: "est", predicted: 4.5, isCatalog: false, sim: 0.9, greatValue: true, price: 20 });
    expect(compareCallCandidates(catalog, estimate)).toBeLessThan(0);
    expect(pickCall([estimate, catalog])!.key).toBe("cat");
  });

  it("2. maxSimilarity decides when catalog status matches", () => {
    const near = row({ key: "near", predicted: 4.5, sim: 0.80, greatValue: false, price: 200 });
    const far = row({ key: "far", predicted: 4.5, sim: 0.40, greatValue: true, price: 20 });
    expect(compareCallCandidates(near, far)).toBeLessThan(0);
    expect(pickCall([far, near])!.key).toBe("near");
  });

  it("3. greatValue decides when confidence is equal (similarity inside the noise floor)", () => {
    const value = row({ key: "value", predicted: 4.5, sim: 0.500, greatValue: true, price: 200 });
    const plain = row({ key: "plain", predicted: 4.5, sim: 0.505, greatValue: false, price: 20 });
    expect(compareCallCandidates(value, plain)).toBeLessThan(0);
    expect(pickCall([plain, value])!.key).toBe("value");
  });

  it("4. lower price is the last resort between wines we trust equally", () => {
    const cheap = row({ key: "cheap", predicted: 4.5, sim: 0.5, greatValue: false, price: 60 });
    const dear = row({ key: "dear", predicted: 4.5, sim: 0.5, greatValue: false, price: 300 });
    expect(compareCallCandidates(cheap, dear)).toBeLessThan(0);
    expect(pickCall([dear, cheap])!.key).toBe("cheap");
  });

  it("higher predicted still beats everything outside the 0.1 window", () => {
    const best = row({ key: "best", predicted: 4.6, isCatalog: false, sim: 0.1, price: 400 });
    const worse = row({ key: "worse", predicted: 4.2, isCatalog: true, sim: 0.9, price: 30 });
    expect(pickCall([best, worse])!.key).toBe("best");
  });
});

describe("a missing price never sorts as expensive", () => {
  it("abstains rather than pushing the unpriced wine last", () => {
    const unknown = row({ key: "unknown", predicted: 4.5, sim: 0.5, price: null });
    const priced = row({ key: "priced", predicted: 4.5, sim: 0.5, price: 40 });
    expect(compareCallCandidates(unknown, priced)).toBe(0);
    expect(compareCallCandidates(priced, unknown)).toBe(0);
  });

  it("an unpriced wine still wins on a rule that ranks above price", () => {
    const unknown = row({ key: "unknown", predicted: 4.5, sim: 0.9, price: null });
    const priced = row({ key: "priced", predicted: 4.5, sim: 0.4, price: 40 });
    expect(pickCall([priced, unknown])!.key).toBe("unknown");
  });

  it("treats zero and non-finite amounts as unknown too", () => {
    const zero = row({ key: "zero", predicted: 4.5, sim: 0.5, price: 0 });
    const priced = row({ key: "priced", predicted: 4.5, sim: 0.5, price: 40 });
    expect(compareCallCandidates(zero, priced)).toBe(0);
  });
});

describe("nearTieNote — detail sheet only", () => {
  it("names the single near-tied wine", () => {
    const a = row({ key: "a", predicted: 4.5, name: "Chinon Les Picasses" });
    const b = row({ key: "b", predicted: 4.45, name: "Bourgueil Nuits d'Ivresse" });
    expect(nearTieNote(a, [a, b])).toBe("Bourgueil Nuits d'Ivresse scored within 0.1 of this.");
  });

  it("counts when several are near-tied", () => {
    const a = row({ key: "a", predicted: 4.5 });
    const rows = [a, row({ key: "b", predicted: 4.45 }), row({ key: "c", predicted: 4.42 })];
    expect(nearTieNote(a, rows)).toBe("2 other wines on this list scored within 0.1 of this.");
  });

  it("returns nothing when the Call is clear", () => {
    const a = row({ key: "a", predicted: 4.5 });
    expect(nearTieNote(a, [a, row({ key: "b", predicted: 3.8 })])).toBeNull();
  });
});

describe("pricePosition instrumentation", () => {
  // Nine priced wines — clears the 8-priced floor.
  const list = [10, 20, 30, 40, 50, 60, 70, 80, 90].map((p, i) =>
    row({ key: `k${i}`, predicted: 4, price: p }),
  );

  it("reads terciles of the list's own spread", () => {
    expect(pricePosition(list[0], list)).toBe("bottom-third");
    expect(pricePosition(list[4], list)).toBe("middle");
    expect(pricePosition(list[8], list)).toBe("top-third");
  });

  it("is unknown when the Call has no price", () => {
    expect(pricePosition(row({ key: "x", predicted: 4, price: null }), list)).toBe("unknown");
  });

  it("is insufficient — not unknown — on a list too short for terciles", () => {
    expect(pricePosition(list[0], list.slice(0, 4))).toBe("insufficient");
    expect(pricePosition(list[0], list.slice(0, 7))).toBe("insufficient");
    expect(pricePosition(list[0], list.slice(0, 8))).toBe("bottom-third");
  });

  it("is unknown — not insufficient — when no wine on the list has a price", () => {
    const unpriced = [0, 1, 2].map((i) => row({ key: `u${i}`, predicted: 4, price: null }));
    expect(pricePosition(row({ key: "x", predicted: 4, price: 40 }), unpriced)).toBe("unknown");
  });

  it("counts only readable prices", () => {
    expect(countPriced(list)).toBe(9);
    expect(countPriced([...list.slice(0, 3), row({ key: "n", predicted: 4, price: null })])).toBe(3);
  });
});

describe("thin reads may be ranked but never named as the Call", () => {
  const thin = { acid: 0.6, body: 0.5, savory: 0.4 };            // 3 active axes
  const solid = { acid: 0.6, body: 0.5, savory: 0.4, tannin: 0.7, ripe: 0.5 };

  it("passes over a higher-scoring wine read on only three axes", () => {
    const shallow = row({ key: "shallow", predicted: 4.6, fp: thin });
    const read = row({ key: "read", predicted: 4.55, fp: solid });
    expect(pickCall([shallow, read])!.key).toBe("read");
  });

  it("keeps the thin wine eligible for the list, only out of the shortlist", () => {
    const shallow = row({ key: "shallow", predicted: 4.6, fp: thin });
    const read = row({ key: "read", predicted: 4.55, fp: solid });
    expect(callEligible([shallow, read]).map((r) => r.key)).toEqual(["read"]);
  });

  it("still names one when every candidate is a thin read", () => {
    const a = row({ key: "a", predicted: 4.6, fp: thin });
    const b = row({ key: "b", predicted: 4.1, fp: thin });
    expect(pickCall([a, b])!.key).toBe("a");
  });

  it("a wine with no reading object is not treated as thin", () => {
    const legacy = row({ key: "legacy", predicted: 4.6, fp: null });
    const read = row({ key: "read", predicted: 4.55, fp: solid });
    expect(pickCall([legacy, read])!.key).toBe("legacy");
  });
});

describe("estimated lines rank but cannot be the Call", () => {
  it("passes over a higher-scoring estimated line for a catalog reading", () => {
    const est = row({ key: "moulis", predicted: 4.6, isCatalog: false, sim: 0.9 });
    const cat = row({ key: "chasse-spleen", predicted: 3.8, isCatalog: true, sim: 0.4 });
    expect(pickCall([est, cat])!.key).toBe("chasse-spleen");
  });

  it("keeps the estimated line eligible for the list and the alternates", () => {
    const est = row({ key: "est", predicted: 4.6, isCatalog: false });
    const cat = row({ key: "cat", predicted: 3.8, isCatalog: true });
    expect(callEligible([est, cat]).map((r) => r.key)).toEqual(["cat"]);
  });

  it("still names one when no line on the list matched the catalog", () => {
    const a = row({ key: "a", predicted: 4.6, isCatalog: false });
    const b = row({ key: "b", predicted: 4.1, isCatalog: false });
    expect(pickCall([a, b])!.key).toBe("a");
  });

  it("a thin catalog read is preferred over an estimate, and only stands down within the catalog pool", () => {
    const thin = { acid: 0.6, body: 0.5, savory: 0.4 };
    const est = row({ key: "est", predicted: 4.9, isCatalog: false });
    const thinCat = row({ key: "thin-cat", predicted: 4.0, isCatalog: true, fp: thin });
    expect(pickCall([est, thinCat])!.key).toBe("thin-cat");
  });
});
