import { describe, expect, it } from "vitest";
import { computeCode, describeCode, parseCode, RED_AXES, WHITE_AXES, splitCode, slotsOf, isBimodalSlot, poleOf } from "@/lib/palate";
import { explainLetter } from "@/lib/palate-code-letters";

const flat = { body: 0.5, fruit_char: 0.5, tannin: 0.5, acidity: 0.5, sweet: 0 };

/** Six loved reds: tannin mean is firmly grippy, yet both poles are loved. */
const grippyBimodal = [
  { stars: 5, values: { ...flat, tannin: 0.95 } },
  { stars: 5, values: { ...flat, tannin: 0.92 } },
  { stars: 5, values: { ...flat, tannin: 0.90 } },
  { stars: 5, values: { ...flat, tannin: 0.88 } },
  { stars: 4, values: { ...flat, tannin: 0.20 } },
  { stars: 4, values: { ...flat, tannin: 0.25 } },
];

/** Six loved reds whose body mean is mid-range with both poles loved → N±. */
const balancedBimodal = [
  { stars: 5, values: { ...flat, body: 0.95 } },
  { stars: 5, values: { ...flat, body: 0.90 } },
  { stars: 5, values: { ...flat, body: 0.10 } },
  { stars: 5, values: { ...flat, body: 0.05 } },
  { stars: 4, values: { ...flat, body: 0.85 } },
  { stars: 4, values: { ...flat, body: 0.15 } },
];

describe("palate code glyphs", () => {
  it("unresolved is 'X' — a letter, so a new user's code is still five long", () => {
    const { letters, code } = computeCode([], RED_AXES);
    expect(code).toBe("XXXXX");
    expect(letters.every((l) => l.letter === "X" && !l.bimodal)).toBe(true);
    expect(code).not.toContain("·");
    expect(code).not.toContain("?");
    expect(code).not.toContain("±");
  });

  it("bimodality qualifies the dominant pole instead of erasing it", () => {
    const { letters } = computeCode(grippyBimodal, RED_AXES);
    const tannin = letters.find((l) => l.axis === "tannin")!;
    expect(tannin.bimodal).toBe(true);
    expect(tannin.value!).toBeGreaterThan(0.55);
    expect(tannin.letter).toBe("G±");
    expect(tannin.descriptor).toBe("mostly grippy, with a silky side");
  });

  it("balanced bimodal keeps a letter: N±, never a bare marker", () => {
    const { letters, code } = computeCode(balancedBimodal, RED_AXES);
    const body = letters.find((l) => l.axis === "body")!;
    expect(body.bimodal).toBe(true);
    expect(body.letter).toBe("N±");
    expect(code.startsWith("N±")).toBe(true);
    // No slot is a bare marker.
    expect(parseCode(code, RED_AXES).every((s) => /^[A-Z]±?$/.test(s))).toBe(true);
  });

  it("splitCode treats a letter-plus-marker as one slot", () => {
    expect(splitCode("BNG±CD")).toEqual(["B", "N", "G±", "C", "D"]);
    expect(splitCode("B±N±CDX")).toEqual(["B±", "N±", "C", "D", "X"]);
    // Legacy codes still decode: "·" → X, a bare "±" → N±.
    expect(splitCode("·····")).toEqual(["X", "X", "X", "X", "X"]);
    expect(splitCode("L±SND")).toEqual(["L±", "S", "N", "D"]);
    expect(splitCode("±±UCD")).toEqual(["N±", "N±", "U", "C", "D"]);
    expect(slotsOf("BN")).toEqual(["B", "N", "X", "X", "X"]);
    expect(isBimodalSlot("G±")).toBe(true);
    expect(poleOf("G±")).toBe("G");
    expect(poleOf("N±")).toBe("N");
    expect(poleOf("X")).toBe(null);
  });

  it("explains a marked slot by its dominant pole, and N± as both ends", () => {
    const marked = explainLetter("red", "BNG±CD", 2);
    expect(marked.axisLabel).toBe("Tannin");
    expect(marked.meaning).toContain("grippy");
    expect(marked.meaning).toContain("both work");
    const balanced = explainLetter("red", "BNN±CD", 2);
    expect(balanced.meaning).toBe("You love both silky and grippy — style over structure.");
    const unresolved = explainLetter("red", "BNXCD", 2);
    expect(unresolved.meaning).toContain("needs more ratings");
  });

  it("describeCode reads as a sentence with the qualifier in place", () => {
    const { letters } = computeCode(grippyBimodal, RED_AXES);
    expect(describeCode(letters)).toContain("mostly grippy, with a silky side");
  });
});

describe("parseCode (axis-aware, linear — no backtracking)", () => {
  it("reads one letter per slot, marker attached", () => {
    // Owner's real red code: bold; both ways on fruit; mostly grippy; crisp; dry.
    expect(parseCode("BN±G±CD", RED_AXES)).toEqual(["B", "N±", "G±", "C", "D"]);
    expect(parseCode("B±FG±CD", RED_AXES)).toEqual(["B±", "F", "G±", "C", "D"]);
    expect(parseCode("LFS±RD", RED_AXES)).toEqual(["L", "F", "S±", "R", "D"]);
    expect(parseCode("XXXXX", RED_AXES)).toEqual(["X", "X", "X", "X", "X"]);
    expect(parseCode("·····", WHITE_AXES)).toEqual(["X", "X", "X", "X", "X"]);
    expect(parseCode("N±N±UCD", WHITE_AXES)).toEqual(["N±", "N±", "U", "C", "D"]);
    // A letter that isn't in this axis's alphabet degrades to unresolved.
    expect(parseCode("GFUCD", WHITE_AXES)[0]).toBe("X");
  });
});

describe("INVARIANT: a palate code is always exactly five letters", () => {
  const SLOT = /^[A-Z]±?$/;
  const check = (code: string, axes = RED_AXES) => {
    const slots = parseCode(code, axes);
    expect(slots).toHaveLength(5);
    for (const s of slots) expect(s).toMatch(SLOT);
    // Letters (markers stripped) are exactly five.
    expect(slots.map((s) => s[0]).join("")).toHaveLength(5);
  };

  it("holds for computed codes, including zero ratings", () => {
    for (const axes of [RED_AXES, WHITE_AXES]) {
      for (const rated of [[], grippyBimodal, balancedBimodal, [{ stars: 5, values: flat }]]) {
        const { code, letters } = computeCode(rated, axes);
        expect(letters).toHaveLength(5);
        check(code, axes);
      }
    }
  });

  it("holds for arbitrary, legacy, empty and corrupt input", () => {
    const inputs = [
      "", "·····", "±±±±±", "XXXXX", "?????", "B", "BN", "LXSND", "B±±CD?",
      "BN±G±CD", "N±N±UCD", "zzzzz", "ABCDEFGHIJ", "±", "N±",
      "\u00b1\u00b1", "L F S N D", "bnGcd",
    ];
    for (const code of inputs) {
      check(code, RED_AXES);
      check(code, WHITE_AXES);
    }
  });
});
