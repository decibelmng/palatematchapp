import { describe, it, expect } from "vitest";
import {
  classify, summarize, pickTableCall, reasoningSentence, containsForbidden, FORBIDDEN_VOCAB,
} from "../table-call";

const g = (userId: string, predicted: number) => ({
  userId, archetype: "Silk & Perfume", initial: userId[0].toUpperCase(), predicted,
});

// A guest who has never rated this bottle's type → "cant-say".
const gu = (userId: string) => ({
  userId, archetype: "Silk & Perfume", initial: userId[0].toUpperCase(), predicted: 3.0, untested: true,
});

describe("classify", () => {
  it("maps to ordinals at the documented thresholds", () => {
    expect(classify(4.5)).toBe("loves");
    expect(classify(4.25)).toBe("loves");
    expect(classify(4.24)).toBe("fine");
    expect(classify(3.5)).toBe("fine");
    expect(classify(3.49)).toBe("not-for-them");
  });
});

describe("reasoningSentence", () => {
  it("safe convergence: 2 loves, no misses", () => {
    const c = summarize("c1", [g("a", 4.5), g("b", 4.4), g("c", 3.8)]);
    expect(reasoningSentence(c)).toBe(
      "Two guests love it, nobody dislikes it — the safest bottle on the list.",
    );
  });
  it("everyone in the middle", () => {
    const c = summarize("c1", [g("a", 3.7), g("b", 3.6), g("c", 3.9)]);
    expect(reasoningSentence(c)).toBe(
      "Everyone lands in the same middle — no one's disappointed.",
    );
  });
  it("one love, no misses", () => {
    const c = summarize("c1", [g("a", 4.4), g("b", 3.9), g("c", 3.7)]);
    expect(reasoningSentence(c)).toBe(
      "One guest loves it, nobody at this table rates it below a good match.",
    );
  });
});

describe("pickTableCall", () => {
  it("safe convergence picks the maximin winner", () => {
    const c1 = summarize("safe", [g("a", 4.5), g("b", 4.3), g("c", 3.8)]);
    const c2 = summarize("great-for-a-not-b", [g("a", 5), g("b", 2.5), g("c", 4.0)]);
    const call = pickTableCall([c1, c2]);
    expect(call.kind).toBe("one-bottle");
    expect(call.winner?.candidateId).toBe("safe");
    expect(call.reasoning).toMatch(/safest bottle/);
  });

  it("lopsided: chooses the least-bad single bottle when nothing converges", () => {
    // No candidate is fine+ for everyone; the pair also fails → single fallback.
    const c1 = summarize("meh", [g("a", 3.3), g("b", 3.3), g("c", 3.3)]);
    const call = pickTableCall([c1]);
    expect(call.kind).toBe("one-bottle");
    expect(call.winner?.candidateId).toBe("meh");
    expect(containsForbidden(call.reasoning)).toBeNull();
  });

  it("split: two bottles cover the table when no single one can", () => {
    const c1 = summarize("for-red-drinkers", [g("a", 4.6), g("b", 4.4), g("c", 2.5)]);
    const c2 = summarize("for-white-drinker", [g("a", 3.0), g("b", 3.0), g("c", 4.7)]);
    const call = pickTableCall([c1, c2]);
    expect(call.kind).toBe("split");
    expect(call.splitPair?.map((p) => p.candidateId).sort()).toEqual(
      ["for-red-drinkers", "for-white-drinker"],
    );
    expect(call.splitAssignment?.c).toBe(
      call.splitPair?.[0].candidateId === "for-white-drinker" ? "a" : "b",
    );
    expect(call.reasoning).toBe(
      "This table doesn't converge — two bottles serve it better than one.",
    );
  });

  it("returns empty reasoning on empty input", () => {
    expect(pickTableCall([]).reasoning).toBe("");
  });
});

describe("cant-say (untested type is neutral, never a veto)", () => {
  it("summarize marks an untested guest 'cant-say' and excludes them from the math", () => {
    const c = summarize("white-bottle", [g("a", 4.5), g("b", 4.3), gu("c")]);
    expect(c.guests.find((p) => p.userId === "c")?.verdict).toBe("cant-say");
    // The red-only guest doesn't drag it down: still fine+ with 2 loves.
    expect(c.finePlus).toBe(true);
    expect(c.lovesCount).toBe(2);
    expect(c.worstVerdict).toBe("loves");
  });

  it("a red-only guest does NOT force a white into a split", () => {
    // Old behaviour: gu('c') scored 3.0 → not-for-them → this bottle could never win.
    const white = summarize("white", [g("a", 4.6), g("b", 4.4), gu("c")]);
    const call = pickTableCall([white]);
    expect(call.kind).toBe("one-bottle");
    expect(call.winner?.candidateId).toBe("white");
    expect(containsForbidden(call.reasoning)).toBeNull();
  });

  it("honest tail when some guests can't be read on this style", () => {
    const c = summarize("c1", [g("a", 4.5), g("b", 4.4), gu("c")]);
    expect(reasoningSentence(c)).toBe(
      "Two guests love it, nobody dislikes it — the safest bottle on the list. One guest hasn't rated this style, so this reads the rest of the table.",
    );
  });

  it("all-untested reads as an honest non-answer, not a rejection", () => {
    const c = summarize("mystery", [gu("a"), gu("b")]);
    expect(c.finePlus).toBe(false);
    expect(c.worstVerdict).toBe("cant-say");
    expect(reasoningSentence(c)).toBe(
      "No one at this table has rated this style yet — I can't call it for them.",
    );
    expect(containsForbidden(reasoningSentence(c))).toBeNull();
  });
});

describe("vocabulary gate", () => {
  it("every reasoning phrase avoids internal terms", () => {
    const cases = [
      summarize("a", [g("a", 4.5), g("b", 4.4)]),
      summarize("b", [g("a", 4.4), g("b", 3.9)]),
      summarize("c", [g("a", 3.7), g("b", 3.7)]),
      summarize("d", [g("a", 3.0), g("b", 3.0)]),
    ];
    for (const c of cases) {
      expect(containsForbidden(reasoningSentence(c))).toBeNull();
    }
    // Sanity: the gate does fire on a forbidden term.
    expect(FORBIDDEN_VOCAB.length).toBeGreaterThan(0);
    expect(containsForbidden("The kernel says no.")).toBe("kernel");
  });
});
