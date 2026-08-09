import { describe, expect, it } from "vitest";
import { codePhrases, codeSentence, explainLetter } from "@/lib/palate-code-letters";

describe("decoded palate-code words", () => {
  it("renders five phrases for every code", () => {
    for (const c of ["BN±G±CD", "N±N±UCD", "XXXXX", "LFSRD"]) {
      expect(codePhrases("red", c)).toHaveLength(5);
      expect(codePhrases("red", c).every((p) => p.length > 0)).toBe(true);
    }
  });

  it("reads the owner's red code", () => {
    expect(codePhrases("red", "BN±G±CD")).toEqual([
      "bold", "fruit both ways", "mostly grippy", "crisp", "dry",
    ]);
  });

  it("reads white slot 3 as oak, never grip", () => {
    expect(codePhrases("white", "N±N±UCD")[2]).toBe("unoaked");
    expect(codePhrases("white", "N±N±OCD")[2]).toBe("oaked");
    expect(codePhrases("white", "N±N±N±CD")[2]).toBe("oak both ways");
  });

  it("agrees with the tap explainer on the axis", () => {
    expect(explainLetter("white", "N±N±UCD", 2).axisLabel).toBe("Oak");
    expect(explainLetter("red", "BN±G±CD", 2).axisLabel).toBe("Tannin");
  });

  it("writes a sentence for link previews", () => {
    expect(codeSentence("red", "BN±G±CD")).toBe(
      "Bold reds, fruit both ways, mostly grippy, crisp and dry.",
    );
    expect(codeSentence("white", "XXXXX")).toMatch(/Not enough ratings/);
  });
});
