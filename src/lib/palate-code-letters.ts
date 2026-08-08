// Letter-by-letter explanations for the palate code.
//
// A five-letter code is only an identity if a person can read it. This maps
// each character to a one-line plain-language explanation ("B for bold",
// "S for silky") that the profile screen surfaces on tap and auto-cycles
// once on first reveal. The mapping mirrors the letters produced by
// computeCode() in src/lib/palate.ts — keep the two in sync.
//
// Position semantics differ by type:
//   Red   → body, fruit_char, tannin,  acidity, sweet
//   White → body, fruit_char, oak,     acidity, sweet
//
// Shared glyphs: N = moderate for that position, ? = not enough ratings yet,
// ± = bimodal (loves both poles). A slot may be a pole letter PLUS the marker
// ("G±" = mostly grippy, with a silky side) — always read slots via splitCode(),
// never by character index.

import type { PaletteType } from "@/lib/palate";
import { axesFor, GLYPH_BIMODAL, GLYPH_MODERATE, GLYPH_UNRESOLVED, isBimodalSlot, parseCode, poleOf } from "@/lib/palate";

export type LetterMeaning = {
  letter: string;
  /** The axis this letter position represents, in plain language. */
  axisLabel: string;
  /** One-line meaning: "B for bold — you go for the heavier reds." */
  meaning: string;
};

const RED_POSITIONS: Array<{ axis: string; letters: Record<string, string> }> = [
  { axis: "Body", letters: {
      L: "L for light — you lean toward the airy, elegant reds.",
      B: "B for bold — you go for the heavier, denser reds.",
      N: "Balanced — neither light nor heavy is your default.",
      "±": "You love both light and full — a rare split.",
      X: "Body needs more ratings — rate a few more reds.",
  } },
  { axis: "Fruit", letters: {
      F: "F for fruit-forward — ripe, generous fruit up front.",
      E: "E for earthy — forest floor, savor, something under the fruit.",
      N: "Balanced — you accept both fruit-driven and savory reds.",
      "±": "You love both fruit-forward and earthy reds.",
      X: "Fruit character needs more ratings.",
  } },
  { axis: "Tannin", letters: {
      S: "S for silky — smooth, fine-grained tannin.",
      G: "G for grippy — firm, drying, structured tannin.",
      N: "Balanced — texture isn't a strong preference either way.",
      "±": "You love both silky and grippy — style over structure.",
      X: "Tannin preference needs more ratings.",
  } },
  { axis: "Acidity", letters: {
      R: "R for round — softer, rounder wines suit you.",
      C: "C for crisp — mouthwatering, lifted, bright.",
      N: "Balanced acidity works for you.",
      "±": "You love both round and crisp reds.",
      X: "Acidity preference needs more ratings.",
  } },
  { axis: "Sweet", letters: {
      D: "D for dry — the standard for you.",
      W: "W for sweet — you enjoy an off-dry lift.",
      N: "Balanced — mostly dry with occasional off-dry.",
      "±": "You love both dry and sweet reds.",
      X: "Sweetness preference needs more ratings.",
  } },
];

const WHITE_POSITIONS: Array<{ axis: string; letters: Record<string, string> }> = [
  { axis: "Body", letters: {
      L: "L for light — you lean toward airy, delicate whites.",
      B: "B for bold — you go for weightier, viscous whites.",
      N: "Balanced — neither featherweight nor heavy is your default.",
      "±": "You love both light and full-bodied whites.",
      X: "Body needs more ratings — rate a few more whites.",
  } },
  { axis: "Fruit", letters: {
      F: "F for fruit-forward — ripe, generous fruit up front.",
      E: "E for mineral-savory — stone, salt, the opposite of ripe.",
      N: "Balanced — you accept both fruit-driven and savory whites.",
      "±": "You love both fruit-forward and mineral whites.",
      X: "Fruit character needs more ratings.",
  } },
  { axis: "Oak", letters: {
      U: "U for unoaked — you like whites steely and pure.",
      O: "O for oaked — you go for creamy, toasty, generously oaked.",
      N: "Balanced — a light hand with oak is fine either way.",
      "±": "You love both unoaked and oaked whites.",
      X: "Oak preference needs more ratings.",
  } },
  { axis: "Acidity", letters: {
      R: "R for round — softer, rounder whites suit you.",
      C: "C for crisp — mouthwatering, lifted, bright.",
      N: "Balanced acidity works for you.",
      "±": "You love both round and crisp whites.",
      X: "Acidity preference needs more ratings.",
  } },
  { axis: "Sweet", letters: {
      D: "D for dry — the standard for you.",
      W: "W for sweet — you enjoy an off-dry lift.",
      N: "Balanced — mostly dry with occasional off-dry.",
      "±": "You love both dry and sweet whites.",
      X: "Sweetness preference needs more ratings.",
  } },
];

/** Return the one-line meaning for the slot at `position` (0-indexed) of a code
 *  of the given type. Every slot is one letter plus an optional "±": "G±" reads
 *  as the dominant pole, qualified; "N±" reads as "loves both ends"; "X" is
 *  unresolved. Unknown glyphs return a safe fallback. */
export function explainLetter(
  type: PaletteType,
  code: string,
  position: number,
  bimodal?: boolean,
): LetterMeaning {
  const positions = type === "red" ? RED_POSITIONS : WHITE_POSITIONS;
  const pos = positions[position];
  const slots = parseCode(code, axesFor(type));
  let slot = slots[position] ?? GLYPH_UNRESOLVED;
  // Legacy callers passed `bimodal` alongside an unmarked slot.
  if (bimodal && !isBimodalSlot(slot)) {
    slot = (slot === GLYPH_UNRESOLVED ? GLYPH_MODERATE : slot) + GLYPH_BIMODAL;
  }
  if (!pos) return { letter: slot, axisLabel: "", meaning: "" };

  const pole = poleOf(slot);
  const marked = isBimodalSlot(slot);
  let meaning: string;
  if (marked && (pole === null || pole === GLYPH_MODERATE)) {
    // Balanced bimodal — loves both ends, no dominant side.
    meaning = pos.letters[GLYPH_BIMODAL] ?? `${slot} — ${pos.axis.toLowerCase()} preference.`;
  } else if (pole && marked) {
    const base = pos.letters[pole] ?? `${pole} — ${pos.axis.toLowerCase()} preference.`;
    meaning = `${base} You also love the other side of this one — it leans your way, but both work.`;
  } else {
    meaning = pos.letters[slot] ?? `${slot} — ${pos.axis.toLowerCase()} preference.`;
  }
  return { letter: slot, axisLabel: pos.axis, meaning };
}


/** All five explanations for a code (used by the auto-cycle on first view). */
export function explainCode(type: PaletteType, code: string): LetterMeaning[] {
  return parseCode(code, axesFor(type)).map((_, i) => explainLetter(type, code, i));
}
