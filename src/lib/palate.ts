// Engine 1 — Type-aware Palate Code.
// A person has TWO palates: a Red palate and a White palate. They are computed
// independently and never blended; types are never compared to each other.
//
// GLYPHS (a slot is one letter, optionally followed by the bimodal marker):
//   L/B, F/E, S/G, U/O, R/C, D/W → the pole this palate leans to
//   N   → moderate: the mean sits mid-range, no pole
//   ±   → bimodal with no dominant side (mean mid-range, both poles loved)
//   G±  → letter-plus-marker: leans grippy, with a real silky side
//   ?   → unresolved: not enough ratings yet
// "·" (unresolved) and "X" (bimodal) are the legacy glyphs; splitCode() still
// reads them so codes stored before this change decode correctly.
//
// PENDING — slot 5 (sweet) vs oak, do not act before the catalog re-fingerprint:
//   Sweet carries ~0 bits today: 86% of the catalog sits at the dry floor and
//   51 of the owner's 54 rated bottles do too. fp_oak has a broad, roughly
//   trimodal spread and is absent from the red code, so swapping oak into slot
//   5 for reds looks obvious. It is NOT safe yet: both distributions are
//   measured over 118k rows of typicity-grid values, and the grid's own
//   construction may be producing both the sweet concentration and the oak
//   spread. Recompute both after the re-fingerprint; swap only if sweet is
//   still dead and oak still broad on real per-wine data.
//   Same hold on the red-axis correlations (body–tannin r≈0.73,
//   fruit_dark–body r≈0.74): grid-derived, so no slot gets retired on them.

export type PaletteType = "red" | "white";

/** Bimodal marker — appended to a pole letter, or standing alone when the
 *  weighted mean sits mid-range and neither side dominates. */
export const GLYPH_BIMODAL = "±";
/** Not enough ratings on this axis yet. Distinct from N (a real moderate). */
export const GLYPH_UNRESOLVED = "?";
/** Moderate — the mean sits mid-range and the bimodal test did not fire. */
export const GLYPH_MODERATE = "N";

/** Split a code into its five slots. A slot is a single glyph optionally
 *  followed by the bimodal marker ("G±"), so codes are no longer fixed-width
 *  and MUST NOT be indexed by character. Legacy "·"/"X" map to "?"/"±". */
export function splitCode(code: string): string[] {
  const slots: string[] = [];
  const chars = Array.from(code ?? "");
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    if (ch === "·") ch = GLYPH_UNRESOLVED;
    else if (ch === "X") ch = GLYPH_BIMODAL;
    if (ch === GLYPH_BIMODAL && slots.length > 0) {
      const prev = slots[slots.length - 1];
      // A marker directly after a pole letter qualifies it rather than
      // occupying its own slot.
      if (prev.length === 1 && prev !== GLYPH_BIMODAL && prev !== GLYPH_UNRESOLVED && chars[i - 1] !== GLYPH_BIMODAL) {
        slots[slots.length - 1] = prev + GLYPH_BIMODAL;
        continue;
      }
    }
    slots.push(ch);
  }
  return slots;
}

/** Pad/trim to five slots — for comparing two codes of different vintages. */
export function slotsOf(code: string | null | undefined, count = 5): string[] {
  const s = splitCode(code ?? "");
  while (s.length < count) s.push(GLYPH_UNRESOLVED);
  return s.slice(0, count);
}

/** True when this slot carries the bimodal marker. */
export function isBimodalSlot(slot: string): boolean {
  return slot.includes(GLYPH_BIMODAL);
}

/** The pole letter of a slot, or null for a bare marker / unresolved. */
export function poleOf(slot: string): string | null {
  const ch = slot[0];
  if (!ch || ch === GLYPH_BIMODAL || ch === GLYPH_UNRESOLVED) return null;
  return ch;
}


export type AxisDef = {
  key: string;
  label: string;
  low: string;
  high: string;
  lowName: string;
  highName: string;
  neutralName: string;
};

export const RED_AXES: AxisDef[] = [
  { key: "body",       label: "Body",    low: "L", high: "B", lowName: "light",          highName: "bold",      neutralName: "balanced" },
  { key: "fruit_char", label: "Fruit",   low: "F", high: "E", lowName: "fruit-forward",  highName: "earthy",    neutralName: "balanced" },
  { key: "tannin",     label: "Tannin",  low: "S", high: "G", lowName: "silky",          highName: "grippy",    neutralName: "balanced" },
  { key: "acidity",    label: "Acidity", low: "R", high: "C", lowName: "round",          highName: "crisp",     neutralName: "balanced" },
  { key: "sweet",      label: "Sweet",   low: "D", high: "W", lowName: "dry",            highName: "sweet",     neutralName: "dry" },
];

export const WHITE_AXES: AxisDef[] = [
  { key: "body",       label: "Body",    low: "L", high: "B", lowName: "light",            highName: "bold",         neutralName: "balanced" },
  { key: "fruit_char", label: "Fruit",   low: "F", high: "E", lowName: "fruit-forward",    highName: "mineral-savory", neutralName: "balanced" },
  { key: "oak",        label: "Oak",     low: "U", high: "O", lowName: "unoaked-steely",   highName: "oaked-rich",   neutralName: "balanced" },
  { key: "acidity",    label: "Acidity", low: "R", high: "C", lowName: "round",            highName: "crisp",        neutralName: "balanced" },
  { key: "sweet",      label: "Sweet",   low: "D", high: "W", lowName: "dry",              highName: "sweet",        neutralName: "dry" },
];

export function axesFor(type: PaletteType): AxisDef[] {
  return type === "red" ? RED_AXES : WHITE_AXES;
}

export type RatedBottle = {
  stars: number;
  /** Values for this type's axes; keys match axesFor(type)[i].key. */
  values: Record<string, number>;
  /** True if this rated bottle is a Canon anchor. Its sample weight is multiplied by CANON_WEIGHT. */
  canon?: boolean;
};

/** Same multiplier used in the kernel recommender — kept local to avoid a cycle. */
const CANON_WEIGHT = 3.0;

export type LetterResult = {
  axis: string;
  label: string;
  low: string;
  high: string;
  letter: string;        // 'L'|'B'|'N'|'·'
  descriptor: string;
  resolved: boolean;
  value: number | null;  // weighted mean 0..1 (low pole → high pole)
  bimodal: boolean;
};

export function computeCode(rated: RatedBottle[], axes: AxisDef[]): { code: string; letters: LetterResult[] } {
  const letters: LetterResult[] = axes.map((axisDef) => {
    const base = { axis: axisDef.key, label: axisDef.label, low: axisDef.low, high: axisDef.high };
    if (rated.length === 0) {
      return { ...base, letter: "·", descriptor: "—", resolved: false, value: null, bimodal: false };
    }

    const pts = rated.map((r) => ({
      x: r.values[axisDef.key] ?? 0.5,
      // 1–2★ contribute ~0. Canon anchors get CANON_WEIGHT so their fingerprint
      // pulls each axis toward the benchmark proportional to that weight.
      w: Math.max(0, r.stars - 2) * (r.canon ? CANON_WEIGHT : 1),
      stars: r.stars,
    }));
    const W = pts.reduce((s, p) => s + p.w, 0);
    if (W === 0) {
      return { ...base, letter: "·", descriptor: "—", resolved: false, value: null, bimodal: false };
    }

    const mean = pts.reduce((s, p) => s + p.x * p.w, 0) / W;
    const loved = pts.filter((p) => p.stars >= 4).map((p) => p.x);

    // Sweet override: if every wine in this palate sits at the dry floor, lock to D.
    if (axisDef.key === "sweet" && rated.every((r) => (r.values.sweet ?? 0) <= 0.1)) {
      return { ...base, letter: axisDef.low, descriptor: axisDef.lowName, resolved: true, value: 0, bimodal: false };
    }

    // Bimodal (X) requires real evidence at BOTH poles, not one outlier:
    //   - ≥6 rated wines of this type overall (avoids early-onboarding noise)
    //   - ≥2 loved (≥4★) anchors at the low pole (<0.42)
    //   - ≥2 loved anchors at the high pole (>0.58)
    // Otherwise fall through to the standard letter based on weighted mean.
    let bimodal = false;
    if (rated.length >= 6 && loved.length >= 4) {
      const lowPole = loved.filter((v) => v < 0.42).length;
      const highPole = loved.filter((v) => v > 0.58).length;
      bimodal = lowPole >= 2 && highPole >= 2;
    }

    let letter: string;
    let descriptor: string;
    if (bimodal) {
      // Bimodal renders as a muted middot ("·") — same glyph the reader uses
      // for "not resolved yet", but with a distinct meaning surfaced via the
      // `bimodal` flag. An X reads as an error in every UI convention.
      letter = "·"; descriptor = "loves both poles";
    } else if (mean <= 0.42) {
      letter = axisDef.low; descriptor = axisDef.lowName;
    } else if (mean >= 0.55) {
      letter = axisDef.high; descriptor = axisDef.highName;
    } else {
      letter = "N"; descriptor = axisDef.neutralName;
    }

    return { ...base, letter, descriptor, resolved: true, value: mean, bimodal };
  });

  return { code: letters.map((l) => l.letter).join(""), letters };
}

export function describeCode(letters: LetterResult[]): string {
  const resolved = letters.filter((l) => l.resolved);
  if (resolved.length === 0) return "Rate a few bottles to reveal this palate.";

  const bimodalAxes = resolved.filter((l) => l.bimodal);
  const singles = resolved.filter((l) => !l.bimodal).map((l) => l.descriptor);

  const parts = [...singles];
  if (bimodalAxes.length > 0) {
    const names = bimodalAxes.map((l) => l.label.toLowerCase());
    const joined =
      names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
    parts.push(`loves both poles on ${joined}`);
  }
  return parts.join(", ") + ".";
}
