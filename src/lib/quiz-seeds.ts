// Style-quiz → engine seed conversion.
//
// The onboarding quiz replaces the "rate 5 wines" recall gate. It asks a
// handful of forced-choice sensory questions (silky vs firm, bright vs dark
// fruit, etc.), and each answer nudges a fingerprint axis. We aggregate the
// answers into ONE synthetic "loved" bottle per palate type, tagged
// isSeed:true, and inject it into the KERNEL only. Seeds are excluded from
// the omega ridge fit (see learnOmega in recommender.ts) — a fabricated
// stars=4 is not a real observation.
//
// Linear fade weight:   seedWeight = max(0, 1 - realRatedCountForType / 5)
//
//   real ratings │ seed weight │ seed share of Σw
//   ─────────────┼─────────────┼───────────────────
//        0       │    1.00     │  100%
//        1       │    0.80     │   44%   (0.80 / (0.80 + 1))
//        2       │    0.60     │   23%   (0.60 / (0.60 + 2))
//        3       │    0.40     │   12%   (0.40 / (0.40 + 3))
//        4       │    0.20     │   4.8%  (0.20 / (0.20 + 4))
//        5       │    0.00     │   0%    — seed drops out entirely
//
// This replaces the earlier 1→1→1→1→0 cliff, which was visible to the user
// as a discontinuous jump between ratings 4 and 5. The fade is monotone,
// crosses under 20% by rating 4 (with room to spare), and hits zero at 5.

import type { RatedFp, FpKey, WineType } from "@/lib/recommender";
import type { PaletteType } from "@/lib/palate";

export type QuizVote = -1 | 0 | 1; // low pole / neutral / high pole

/** A forced-choice sensory pair. Each pair moves one or more fp keys. */
export type QuizPair = {
  id: string;
  low: string;           // sensory label for "low" pole (vote = -1)
  high: string;          // sensory label for "high" pole (vote = +1)
  /** fp key → magnitude to add when vote = +1 (and subtract when vote = -1). */
  shifts: Partial<Record<FpKey, number>>;
  /** For the reveal archetype: category this pair maps into. */
  archetype: ArchetypeAxis;
};

export type ArchetypeAxis =
  | "body"          // light ↔ bold
  | "tannin"        // silky ↔ firm
  | "fruit_shade"   // bright ↔ dark fruit
  | "earth"         // ripe/fruit-forward ↔ earthy/savory
  | "acidity"       // round ↔ crisp
  | "oak";          // steely ↔ creamy (white only)

export const RED_PAIRS: QuizPair[] = [
  {
    id: "r-tannin",
    low: "Silky and smooth",
    high: "Firm and structured",
    shifts: { tannin: 0.35 },
    archetype: "tannin",
  },
  {
    id: "r-body",
    low: "Light and elegant",
    high: "Bold and full",
    shifts: { body: 0.35 },
    archetype: "body",
  },
  {
    id: "r-fruit-shade",
    low: "Bright red fruit",
    high: "Dark, brooding fruit",
    shifts: { fruit_dark: 0.35 },
    archetype: "fruit_shade",
  },
  {
    id: "r-earth",
    low: "Ripe and fruit-forward",
    high: "Earthy, savory, forest floor",
    shifts: { savory: 0.30, ripe: -0.25 },
    archetype: "earth",
  },
  {
    id: "r-acid",
    low: "Round and soft",
    high: "Bright and mouthwatering",
    shifts: { acid: 0.35, fresh: 0.15 },
    archetype: "acidity",
  },
  {
    id: "r-power",
    low: "Delicate and perfumed",
    high: "Powerful and dense",
    shifts: { body: 0.20, tannin: 0.20 },
    archetype: "body",
  },
  {
    id: "r-warmth",
    low: "Fresh and lifted",
    high: "Rich and warming",
    shifts: { ripe: 0.25, fresh: -0.20 },
    archetype: "earth",
  },
  {
    id: "r-freshness",
    low: "Crunchy and vibrant",
    high: "Plush and generous",
    shifts: { fresh: -0.20, ripe: 0.20 },
    archetype: "fruit_shade",
  },
];

export const WHITE_PAIRS: QuizPair[] = [
  {
    id: "w-oak",
    low: "Steely and mineral",
    high: "Rich and creamy",
    shifts: { oak: 0.35 },
    archetype: "oak",
  },
  {
    id: "w-acid",
    low: "Round and soft",
    high: "Crisp and mouthwatering",
    shifts: { acid: 0.35, fresh: 0.15 },
    archetype: "acidity",
  },
  {
    id: "w-body",
    low: "Light and delicate",
    high: "Bold and viscous",
    shifts: { body: 0.35 },
    archetype: "body",
  },
  {
    id: "w-fruit",
    low: "Citrus and stone fruit",
    high: "Tropical and honeyed",
    shifts: { ripe: 0.30 },
    archetype: "fruit_shade",
  },
  {
    id: "w-mineral",
    low: "Wet-stone and saline",
    high: "Ripe orchard fruit",
    shifts: { savory: -0.25, ripe: 0.20 },
    archetype: "earth",
  },
  {
    id: "w-oak-2",
    low: "Unoaked and pure",
    high: "Buttery and toasty",
    shifts: { oak: 0.25, body: 0.15 },
    archetype: "oak",
  },
  {
    id: "w-lift",
    low: "Zippy and lean",
    high: "Round and mouth-filling",
    shifts: { acid: -0.20, body: 0.20 },
    archetype: "body",
  },
  {
    // 8th white pair — texture. The existing seven covered oak, acid,
    // body, fruit, mineral character. Phenolic texture (skin-contact
    // whites, extended-lees whites) was under-covered — this pair
    // separates a silky, unimpeded mouthfeel from a grainy, chewy one.
    id: "w-texture",
    low: "Smooth and glassy",
    high: "Grippy and textural",
    shifts: { tannin: 0.25, savory: 0.15 },
    archetype: "earth",
  },
];

export function pairsFor(type: PaletteType): QuizPair[] {
  return type === "red" ? RED_PAIRS : WHITE_PAIRS;
}

export type QuizAnswers = {
  /** "red" | "white" | "both" — determines which pair sets are shown. */
  type: PaletteType | "both";
  /** Per-pair vote, keyed by pair.id. Missing = not answered = neutral. */
  votes: Record<string, QuizVote>;
  /** ISO timestamp when quiz completed. */
  completedAt?: string;
};

/** Build a synthetic fp vector from the quiz answers for a given type.
 *  Start at neutral 0.5 for every key, then apply pair shifts scaled by vote. */
function buildFpFromVotes(pairs: QuizPair[], votes: Record<string, QuizVote>): Record<FpKey, number> {
  const fp: Record<FpKey, number> = {
    fresh: 0.5, acid: 0.5, tannin: 0.5, fruit_dark: 0.5,
    ripe: 0.5, oak: 0.5, body: 0.5, savory: 0.5,
  };
  for (const p of pairs) {
    const v = votes[p.id] ?? 0;
    if (v === 0) continue;
    for (const [k, mag] of Object.entries(p.shifts) as [FpKey, number][]) {
      fp[k] = fp[k] + v * mag;
    }
  }
  // Clamp to a safe interior range so seeds don't sit on the boundary.
  for (const k of Object.keys(fp) as FpKey[]) {
    fp[k] = Math.min(0.95, Math.max(0.05, fp[k]));
  }
  return fp;
}

/** Return the synthetic RatedFp seeds for use in the recommender.
 *  Empty when no quiz answers or when the user already has >= FADE ratings
 *  of the requested type (seeds fade out once real signal exists). */
export const SEED_FADE_THRESHOLD = 5;

export function seedRatedFpFor(
  answers: QuizAnswers | null | undefined,
  type: WineType,
  realRatedCountForType: number,
): RatedFp[] {
  if (!answers) return [];
  if (realRatedCountForType >= SEED_FADE_THRESHOLD) return [];
  if (type !== "red" && type !== "white") return [];
  const t = answers.type;
  if (t !== "both" && t !== type) return [];
  const anyVotes = Object.values(answers.votes ?? {}).some((v) => v !== 0);
  if (!anyVotes) return [];
  const pairs = pairsFor(type);
  // Only consume pair ids that belong to this palette type.
  const relevant: Record<string, QuizVote> = {};
  for (const p of pairs) if (answers.votes[p.id] !== undefined) relevant[p.id] = answers.votes[p.id];
  const fp = buildFpFromVotes(pairs, relevant);
  return [
    {
      id: `__seed-${type}`,
      name: "Your style answers",
      producer: null,
      region: null,
      type,
      fp,
      stars: 4,
      weight: 1,
    },
  ];
}

// ────────── Archetype naming (for the reveal screen) ──────────

export type Archetype = {
  name: string;        // "Silk & Perfume"
  tagline: string;     // one-line plain-language description
  /** Legacy palate-code (5 letters) computed from the fp for social sharing. */
  code: string;
};

/** Compute the archetype from quiz answers for the requested type.
 *  Falls back to a neutral name when the user is truly middle-of-the-road. */
export function archetypeFor(answers: QuizAnswers, type: PaletteType): Archetype {
  const pairs = pairsFor(type);
  const totals: Record<ArchetypeAxis, number> = {
    body: 0, tannin: 0, fruit_shade: 0, earth: 0, acidity: 0, oak: 0,
  };
  for (const p of pairs) {
    const v = answers.votes[p.id] ?? 0;
    totals[p.archetype] += v;
  }
  return pickArchetype(totals, type);
}

function pickArchetype(t: Record<ArchetypeAxis, number>, type: PaletteType): Archetype {
  // Red archetypes
  if (type === "red") {
    if (t.tannin <= -1 && t.body <= 0) return { name: "Silk & Perfume", tagline: "You go for reds that are fragrant and delicate rather than powerful.", code: computeCodeStub(t, "red") };
    if (t.tannin >= 1 && t.body >= 1) return { name: "Iron & Ember", tagline: "You go for reds with backbone — structured, dense, built to last.", code: computeCodeStub(t, "red") };
    if (t.earth >= 1) return { name: "Forest Floor", tagline: "You go for reds with earth, savor, and something mysterious under the fruit.", code: computeCodeStub(t, "red") };
    if (t.fruit_shade >= 1) return { name: "Deep & Brooding", tagline: "You go for reds with dark, plummy fruit and a slow-burning core.", code: computeCodeStub(t, "red") };
    if (t.fruit_shade <= -1) return { name: "Bright & Vivid", tagline: "You go for reds that snap with red fruit and lift, not weight.", code: computeCodeStub(t, "red") };
    if (t.acidity >= 1) return { name: "High Wire", tagline: "You go for reds that stay lifted and mouthwatering, never heavy.", code: computeCodeStub(t, "red") };
    if (t.body >= 1) return { name: "Big & Bold", tagline: "You go for reds with weight, warmth, and generous fruit.", code: computeCodeStub(t, "red") };
    return { name: "The Middle Path", tagline: "You go for reds that balance fruit, freshness, and structure — no extremes.", code: computeCodeStub(t, "red") };
  }
  // White archetypes
  if (t.oak >= 1 && t.body >= 1) return { name: "Butter & Toast", tagline: "You go for whites that are rich, creamy, and generously oaked.", code: computeCodeStub(t, "white") };
  if (t.oak <= -1 && t.acidity >= 1) return { name: "Steel & Salt", tagline: "You go for whites that are lean, mineral, and mouthwatering.", code: computeCodeStub(t, "white") };
  if (t.fruit_shade >= 1) return { name: "Sun & Honey", tagline: "You go for whites with ripe tropical fruit and a soft glow.", code: computeCodeStub(t, "white") };
  if (t.acidity >= 1) return { name: "Bright & Zippy", tagline: "You go for whites with electric acidity and citrus lift.", code: computeCodeStub(t, "white") };
  if (t.earth <= -1) return { name: "Stone & Sea", tagline: "You go for whites that taste of wet stone, salt, and cool air.", code: computeCodeStub(t, "white") };
  if (t.body >= 1) return { name: "Round & Rich", tagline: "You go for whites with weight and a mouth-filling texture.", code: computeCodeStub(t, "white") };
  return { name: "Balanced White", tagline: "You go for whites that stay balanced — neither lean nor lush.", code: computeCodeStub(t, "white") };
}

/** Placeholder 5-letter code from the archetype-axis totals. Real code is
 *  overwritten later by computeCode() once real ratings exist. */
function computeCodeStub(t: Record<ArchetypeAxis, number>, type: PaletteType): string {
  const letter = (val: number, low: string, high: string) =>
    val <= -1 ? low : val >= 1 ? high : "N";
  if (type === "red") {
    return (
      letter(t.body, "L", "B") +
      letter(t.earth, "F", "E") +
      letter(t.tannin, "S", "G") +
      letter(t.acidity, "R", "C") +
      "D"
    );
  }
  return (
    letter(t.body, "L", "B") +
    letter(t.earth, "F", "E") +
    letter(t.oak, "U", "O") +
    letter(t.acidity, "R", "C") +
    "D"
  );
}
