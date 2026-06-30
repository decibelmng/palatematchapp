// Engine 1 — Type-aware Palate Code.
// A person has TWO palates: a Red palate and a White palate. They are computed
// independently and never blended; types are never compared to each other.

export type PaletteType = "red" | "white";

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
};

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
      w: Math.max(0, r.stars - 2), // 1–2★ contribute ~0
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

    let bimodal = false;
    if (loved.length >= 2) {
      const spread = Math.max(...loved) - Math.min(...loved);
      bimodal = spread >= 0.5 && Math.min(...loved) < 0.42 && Math.max(...loved) > 0.58;
    }

    let letter: string;
    let descriptor: string;
    if (bimodal) {
      letter = "N"; descriptor = "loves both poles";
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
  return resolved.map((l) => l.descriptor).join(", ") + ".";
}
