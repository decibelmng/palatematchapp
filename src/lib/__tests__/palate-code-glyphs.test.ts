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

describe("palate code glyphs", () => {
  it("unresolved is '?' and never the bimodal marker", () => {
    const { letters, code } = computeCode([], RED_AXES);
    expect(code).toBe("?????");
    expect(letters.every((l) => l.letter === "?" && !l.bimodal)).toBe(true);
    // The old convention collapsed both meanings into "·".
    expect(code).not.toContain("·");
    expect(code).not.toContain("±");
  });

  it("bimodality qualifies the dominant pole instead of erasing it", () => {
    const { letters } = computeCode(grippyBimodal, RED_AXES);
    const tannin = letters.find((l) => l.axis === "tannin")!;
    expect(tannin.bimodal).toBe(true);
    expect(tannin.value!).toBeGreaterThan(0.55);
    // Old behaviour emitted a bare glyph here, hiding a firmly grippy mean.
    expect(tannin.letter).toBe("G±");
    expect(tannin.descriptor).toBe("mostly grippy, with a silky side");
  });

  it("splitCode treats a letter-plus-marker as one slot", () => {
    expect(splitCode("BNG±CD")).toEqual(["B", "N", "G±", "C", "D"]);
    expect(splitCode("B±±CD?")).toEqual(["B±", "±", "C", "D", "?"]);
    // Legacy codes still decode.
    expect(splitCode("·····")).toEqual(["?", "?", "?", "?", "?"]);
    expect(splitCode("LXSND")).toEqual(["L", "±", "S", "N", "D"]);
    expect(slotsOf("BN")).toEqual(["B", "N", "?", "?", "?"]);
    expect(isBimodalSlot("G±")).toBe(true);
    expect(poleOf("G±")).toBe("G");
    expect(poleOf("±")).toBe(null);
  });

  it("explains a marked slot by its dominant pole, not as a split", () => {
    const marked = explainLetter("red", "BNG±CD", 2);
    expect(marked.axisLabel).toBe("Tannin");
    expect(marked.meaning).toContain("grippy");
    expect(marked.meaning).toContain("both work");
    const bare = explainLetter("red", "BN±CD", 2);
    expect(bare.meaning).toBe("You love both silky and grippy — style over structure.");
    const unresolved = explainLetter("red", "BN?CD", 2);
    expect(unresolved.meaning).toContain("needs more ratings");
  });

  it("describeCode reads as a sentence with the qualifier in place", () => {
    const { letters } = computeCode(grippyBimodal, RED_AXES);
    expect(describeCode(letters)).toContain("mostly grippy, with a silky side");
  });
});

describe("parseCode (axis-aware)", () => {
  it("disambiguates a bare marker that follows a pole letter", () => {
    // Owner's real red code: bold; both fruit styles; mostly grippy; crisp; dry.
    expect(parseCode("B±G±CD", RED_AXES)).toEqual(["B", "±", "G±", "C", "D"]);
    // Same characters, different reading — only the alphabet tells them apart.
    expect(parseCode("B±FG±CD", RED_AXES)).toEqual(["B±", "F", "G±", "C", "D"]);
    expect(parseCode("LFS±RD", RED_AXES)).toEqual(["L", "F", "S±", "R", "D"]);
    expect(parseCode("?????", RED_AXES)).toEqual(["?", "?", "?", "?", "?"]);
    expect(parseCode("·····", WHITE_AXES)).toEqual(["?", "?", "?", "?", "?"]);
    expect(parseCode("LFU±CD", WHITE_AXES)).toEqual(["L", "F", "U±", "C", "D"]);
  });
});
