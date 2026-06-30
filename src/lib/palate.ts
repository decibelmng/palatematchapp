// Engine 1 — Palate Code (projection from stars + bottle axes).
// Type-aware: the Tannin letter resolves only from rated reds.

import type { WineType } from "./recommender";

export type AxisKey = "body" | "fruit_char" | "tannin" | "acidity" | "sweet";

export const AXES: { key: AxisKey; label: string; low: string; high: string; lowName: string; highName: string }[] = [
  { key: "body",       label: "Body",     low: "L", high: "B", lowName: "light",          highName: "bold" },
  { key: "fruit_char", label: "Fruit",    low: "F", high: "E", lowName: "fruit-forward",  highName: "earthy" },
  { key: "tannin",     label: "Tannin",   low: "S", high: "G", lowName: "silky",          highName: "grippy" },
  { key: "acidity",    label: "Acidity",  low: "R", high: "C", lowName: "round",          highName: "crisp" },
  { key: "sweet",      label: "Sweet",    low: "D", high: "W", lowName: "dry",            highName: "sweet" },
];

export type RatedBottle = {
  stars: number;
  type: WineType;
  ax: Record<AxisKey, number>; // 0..1 each
};

export type LetterResult = {
  axis: AxisKey;
  label: string;
  letter: string;        // 'L'|'B'|'N'|'·'|'—'
  descriptor: string;    // human readable
  resolved: boolean;
  value: number | null;  // weighted mean, 0..1 (low pole → high pole); null if unresolved
  bimodal: boolean;
  na: boolean;           // true when the axis doesn't apply to current scope (e.g. tannin w/ no reds)
};


const NEUTRAL_DESCRIPTORS: Record<AxisKey, string> = {
  body: "balanced",
  fruit_char: "balanced",
  tannin: "balanced",
  acidity: "balanced",
  sweet: "dry",
};

function axisPool(axis: AxisKey, rated: RatedBottle[]): RatedBottle[] {
  // Tannin is meaningful only on reds — whites/sparkling/rosé are silent on it.
  if (axis === "tannin") return rated.filter((r) => r.type === "red");
  return rated;
}

export function computeCode(rated: RatedBottle[]): { code: string; letters: LetterResult[] } {
  const letters: LetterResult[] = AXES.map((axisDef) => {
    const axis = axisDef.key;
    const pool = axisPool(axis, rated);

    // Distinguish "nothing rated yet" ("·") from "not applicable until you've rated reds" ("—").
    if (axis === "tannin" && pool.length === 0 && rated.length > 0) {
      return {
        axis,
        label: axisDef.label,
        letter: "—",
        descriptor: "rate reds to reveal",
        resolved: false,
        value: null,
        bimodal: false,
        na: true,
      };
    }

    const pts = pool.map((r) => ({
      x: r.ax[axis],
      w: Math.max(0, r.stars - 2), // 1-2★ contribute ~0
      stars: r.stars,
    }));
    const W = pts.reduce((s, p) => s + p.w, 0);

    if (W === 0) {
      return {
        axis,
        label: axisDef.label,
        letter: "·",
        descriptor: "—",
        resolved: false,
        value: null,
        bimodal: false,
        na: false,
      };
    }

    const mean = pts.reduce((s, p) => s + p.x * p.w, 0) / W;
    const loved = pts.filter((p) => p.stars >= 4).map((p) => p.x);

    if (axis === "sweet" && pool.every((r) => r.ax.sweet <= 0.1)) {
      return {
        axis,
        label: axisDef.label,
        letter: axisDef.low,
        descriptor: axisDef.lowName,
        resolved: true,
        value: 0,
        bimodal: false,
        na: false,
      };
    }

    let bimodal = false;
    if (loved.length >= 2) {
      const spread = Math.max(...loved) - Math.min(...loved);
      bimodal = spread >= 0.5 && Math.min(...loved) < 0.42 && Math.max(...loved) > 0.58;
    }

    let letter: string;
    let descriptor: string;
    if (bimodal) {
      letter = "N";
      descriptor = "loves both poles";
    } else if (mean <= 0.42) {
      letter = axisDef.low;
      descriptor = axisDef.lowName;
    } else if (mean >= 0.55) {
      letter = axisDef.high;
      descriptor = axisDef.highName;
    } else {
      letter = "N";
      descriptor = NEUTRAL_DESCRIPTORS[axis];
    }

    return {
      axis,
      label: axisDef.label,
      letter,
      descriptor,
      resolved: true,
      value: mean,
      bimodal,
      na: false,
    };
  });


  return { code: letters.map((l) => l.letter).join(""), letters };
}

export function describeCode(letters: LetterResult[]): string {
  const resolved = letters.filter((l) => l.resolved);
  if (resolved.length === 0) {
    return "Rate a few bottles to reveal your palate.";
  }
  return resolved.map((l) => l.descriptor).join(", ") + ".";
}
