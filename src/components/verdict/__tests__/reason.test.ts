import { describe, it, expect } from "vitest";
import { becauseLine } from "../reason";
import type { ScanRow } from "../types";
import type { FpKey } from "@/lib/recommender";

// Minimal ScanRow builder for verdict-line testing. We construct just the
// shape becauseLine reads: row.ranked.{vetoed, vetoReason, contested,
// nearest, predicted, bottle.fp}. Everything else is irrelevant here.
function neutralFp(): Record<FpKey, number> {
  return {
    fresh: 0.5, acid: 0.5, tannin: 0.5, fruit_dark: 0.5,
    ripe: 0.5, oak: 0.5, body: 0.5, savory: 0.5,
  };
}

function makeVetoedRow(fp: Record<FpKey, number>, drivingAxes: FpKey[] = []): ScanRow {
  return {
    ranked: {
      vetoed: true,
      contested: false,
      vetoReason: { nemesis: {} as any, distance: 0.1, drivingAxes },
      contestedReason: null,
      nearest: null,
      nearestIsCanon: false,
      maxSimilarity: 0,
      confidence: 0.5,
      evidence: 1,
      evidenceTier: "moderate",
      predicted: 2.0,
      bottle: { fp } as any,
    } as any,
  } as any;
}

describe("becauseLine — sign-aware veto phrasing", () => {
  it("high-side tannin veto uses the grippy phrasing", () => {
    const fp = neutralFp(); fp.tannin = 0.85;
    const line = becauseLine(makeVetoedRow(fp, ["tannin"]));
    expect(line).toContain("drying, grippy");
    expect(line).not.toContain("soft, structureless");
  });

  it("low-side tannin veto uses the soft-structureless phrasing", () => {
    const fp = neutralFp(); fp.tannin = 0.15;
    const line = becauseLine(makeVetoedRow(fp, ["tannin"]));
    expect(line).toContain("soft, structureless");
    expect(line).not.toContain("drying, grippy");
  });

  it("low-side acid veto uses flat/low-acid phrasing", () => {
    const fp = neutralFp(); fp.acid = 0.15;
    const line = becauseLine(makeVetoedRow(fp, ["acid"]));
    expect(line).toContain("flat, low-acid");
  });

  it("skips savory (no complaint in either direction) and falls through", () => {
    const fp = neutralFp(); fp.savory = 0.90; fp.tannin = 0.80;
    // savory is listed FIRST in drivingAxes but has no complaint phrase, so
    // the helper must fall through to tannin's high-side phrase.
    const line = becauseLine(makeVetoedRow(fp, ["savory", "tannin"]));
    expect(line).toContain("drying, grippy");
  });

  it("truly flat fp gets the generic fallback (no axis phrase)", () => {
    const fp = neutralFp();
    const line = becauseLine(makeVetoedRow(fp, []));
    expect(line).toBe("Skip this one — it lands in the exact style you've consistently rated low.");
  });

  it("does not use forbidden internal vocabulary", () => {
    const fp = neutralFp(); fp.tannin = 0.85;
    const line = becauseLine(makeVetoedRow(fp, ["tannin"]));
    expect(line.toLowerCase()).not.toMatch(/nemesis|canon|fingerprint|veto|axis|predicted/);
  });
});
