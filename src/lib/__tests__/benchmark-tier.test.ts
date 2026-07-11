import { describe, it, expect } from "vitest";
import { validateBenchmarkPromotion } from "@/hooks/use-canon";

// Regression: "Mark Nemesis creates a Canon" bug.
// Promotion must select tier explicitly and enforce the star gate that
// mirrors the DB trigger `canon_wines_validate_tier`.
describe("benchmark tier validation", () => {
  it("accepts 5★ as Canon", () => {
    expect(() => validateBenchmarkPromotion("canon", 5)).not.toThrow();
  });
  it("rejects <5★ as Canon", () => {
    for (const s of [1, 2, 3, 4]) {
      expect(() => validateBenchmarkPromotion("canon", s)).toThrow(/Canon/);
    }
  });
  it("accepts 1★ or 2★ as Nemesis", () => {
    expect(() => validateBenchmarkPromotion("nemesis", 1)).not.toThrow();
    expect(() => validateBenchmarkPromotion("nemesis", 2)).not.toThrow();
  });
  it("rejects >2★ as Nemesis", () => {
    for (const s of [3, 4, 5]) {
      expect(() => validateBenchmarkPromotion("nemesis", s)).toThrow(/Nemesis/);
    }
  });
  it("rejects unknown tier — never falls back to a default", () => {
    // @ts-expect-error — deliberate bad input
    expect(() => validateBenchmarkPromotion(undefined, 5)).toThrow();
    // @ts-expect-error — deliberate bad input
    expect(() => validateBenchmarkPromotion("", 5)).toThrow();
  });
});
