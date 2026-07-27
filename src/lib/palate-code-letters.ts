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
// Shared letters: N = neutral for that position, · = not yet resolved,
// X = bimodal (loves both poles on this axis).

import type { PaletteType } from "@/lib/palate";

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
      X: "You love both light and full — a rare split.",
      "·": "Body isn't resolved yet — rate a few more reds.",
  } },
  { axis: "Fruit", letters: {
      F: "F for fruit-forward — ripe, generous fruit up front.",
      E: "E for earthy — forest floor, savor, something under the fruit.",
      N: "Balanced — you accept both fruit-driven and savory reds.",
      X: "You love both fruit-forward and earthy reds.",
      "·": "Fruit character isn't resolved yet.",
  } },
  { axis: "Tannin", letters: {
      S: "S for silky — smooth, fine-grained tannin.",
      G: "G for grippy — firm, drying, structured tannin.",
      N: "Balanced — texture isn't a strong preference either way.",
      X: "You love both silky and grippy — style over structure.",
      "·": "Tannin preference isn't resolved yet.",
  } },
  { axis: "Acidity", letters: {
      R: "R for round — softer, rounder wines suit you.",
      C: "C for crisp — mouthwatering, lifted, bright.",
      N: "Balanced acidity works for you.",
      X: "You love both round and crisp reds.",
      "·": "Acidity preference isn't resolved yet.",
  } },
  { axis: "Sweet", letters: {
      D: "D for dry — the standard for you.",
      W: "W for sweet — you enjoy an off-dry lift.",
      N: "Balanced — mostly dry with occasional off-dry.",
      X: "You love both dry and sweet reds.",
      "·": "Sweetness preference isn't resolved yet.",
  } },
];

const WHITE_POSITIONS: Array<{ axis: string; letters: Record<string, string> }> = [
  { axis: "Body", letters: {
      L: "L for light — you lean toward airy, delicate whites.",
      B: "B for bold — you go for weightier, viscous whites.",
      N: "Balanced — neither featherweight nor heavy is your default.",
      X: "You love both light and full-bodied whites.",
      "·": "Body isn't resolved yet — rate a few more whites.",
  } },
  { axis: "Fruit", letters: {
      F: "F for fruit-forward — ripe, generous fruit up front.",
      E: "E for mineral-savory — stone, salt, the opposite of ripe.",
      N: "Balanced — you accept both fruit-driven and savory whites.",
      X: "You love both fruit-forward and mineral whites.",
      "·": "Fruit character isn't resolved yet.",
  } },
  { axis: "Oak", letters: {
      U: "U for unoaked — you like whites steely and pure.",
      O: "O for oaked — you go for creamy, toasty, generously oaked.",
      N: "Balanced — a light hand with oak is fine either way.",
      X: "You love both unoaked and oaked whites.",
      "·": "Oak preference isn't resolved yet.",
  } },
  { axis: "Acidity", letters: {
      R: "R for round — softer, rounder whites suit you.",
      C: "C for crisp — mouthwatering, lifted, bright.",
      N: "Balanced acidity works for you.",
      X: "You love both round and crisp whites.",
      "·": "Acidity preference isn't resolved yet.",
  } },
  { axis: "Sweet", letters: {
      D: "D for dry — the standard for you.",
      W: "W for sweet — you enjoy an off-dry lift.",
      N: "Balanced — mostly dry with occasional off-dry.",
      X: "You love both dry and sweet whites.",
      "·": "Sweetness preference isn't resolved yet.",
  } },
];

/** Return one-line meaning for the letter at `position` (0-indexed) of a
 *  code of the given type. When `bimodal` is true, the position is treated
 *  as the split-taste case even though it renders as "·" — the user goes
 *  both ways on that axis. Unknown letters return a safe fallback. */
export function explainLetter(
  type: PaletteType,
  code: string,
  position: number,
  bimodal?: boolean,
): LetterMeaning {
  const positions = type === "red" ? RED_POSITIONS : WHITE_POSITIONS;
  const pos = positions[position];
  const rawLetter = (code[position] ?? "·") as string;
  const lookup = bimodal ? "X" : rawLetter;
  if (!pos) return { letter: rawLetter, axisLabel: "", meaning: "" };
  return {
    letter: rawLetter,
    axisLabel: pos.axis,
    meaning: pos.letters[lookup] ?? `${rawLetter} — ${pos.axis.toLowerCase()} preference.`,
  };
}

/** All five explanations for a code (used by the auto-cycle on first view). */
export function explainCode(type: PaletteType, code: string): LetterMeaning[] {
  const out: LetterMeaning[] = [];
  for (let i = 0; i < code.length; i++) out.push(explainLetter(type, code, i));
  return out;
}
