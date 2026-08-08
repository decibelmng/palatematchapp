// Shared source of truth for which fingerprint-axis directions are
// user-facing complaints, plus the surface-specific phrase tables.
//
// BANNED-VOCABULARY SWEEP — always run BOTH patterns (scripts/vocab-sweep.sh):
//   A) string literals:  /("|'|`)[^"'`]*(nemesis|canon|veto|fingerprint|…)[^"'`]*("|'|`)/i
//   B) JSX text nodes:   />[^<>{}"']*(nemesis|canon|veto|fingerprint|…)[^<>{}"']*</i
// The first sweep anchored every pattern on a quote character and so missed
// bare JSX text between tags. One pattern is never a complete sweep.
//
// Two surfaces need this vocabulary:
//   1. reason.ts — a short verdict on one wine in a scan list
//        ("Skip this one — it's the drying, grippy style …").
//   2. sommelier-brief.ts — a formal dealbreaker line to a stranger
//        ("Please steer me away from: drying, aggressive tannin …").
//
// The two surfaces phrase the SAME complaint differently, but they must
// agree on which axis directions ARE complaints. If a direction is not
// something a person complains about (e.g. low tannin — silky wines are
// nobody's dealbreaker), both tables carry an empty string.
//
// isComplaintDirection() and the runtime invariant below enforce that.

import type { FpKey } from "@/lib/recommender";

export type AxisDir = "hi" | "lo";

/** Short, verdict-style phrases used in the scan-list decision surface. */
export const VERDICT_NEG: Record<FpKey, { hi: string; lo: string }> = {
  acid:       { hi: "sharp, high-acid",           lo: "flat, low-acid" },
  tannin:     { hi: "drying, grippy",             lo: "soft, structureless" },
  ripe:       { hi: "jammy, over-ripe",           lo: "green, underripe" },
  oak:        { hi: "heavily oaked",              lo: "" },
  body:       { hi: "big, full-bodied",           lo: "thin, watery" },
  fruit_dark: { hi: "dark-fruited and brooding",  lo: "" },
  fresh:      { hi: "",                            lo: "tired, oxidative" },
  savory:     { hi: "",                            lo: "" },
};

/** Formal, brief-style phrases used in the "For your sommelier" narrative. */
export const SOMMELIER_NEG: Record<FpKey, { hi: string; lo: string }> = {
  ripe:       { hi: "jammy, confected fruit-bombs",     lo: "green, under-ripe fruit" },
  fruit_dark: { hi: "syrupy, over-extracted dark fruit", lo: "" },
  tannin:     { hi: "drying, aggressive tannin",         lo: "soft, structureless reds" },
  acid:       { hi: "searing acidity",                   lo: "flabby, low-acid wines" },
  oak:        { hi: "over-oaked, buttery character",     lo: "" },
  body:       { hi: "heavy, ponderous body",             lo: "thin, watery reds" },
  savory:     { hi: "",                                   lo: "" },
  fresh:      { hi: "",                                   lo: "tired, oxidative bottles" },
};

/** True when the tables agree this axis+direction is a complaint. */
export function isComplaintDirection(axis: FpKey, dir: AxisDir): boolean {
  return VERDICT_NEG[axis][dir] !== "" && SOMMELIER_NEG[axis][dir] !== "";
}

/** Given a wine fingerprint (and optionally the recommender's ranked driving
 *  axes), return the first sensory phrase that describes the *complaint
 *  direction* the wine sits on. Falls through axes when the sign of a
 *  contribution has no user-facing complaint. Returns "" when no axis
 *  qualifies — the caller then uses a generic line. */
export function describeVetoStyleFromFp(
  fp: Record<FpKey, number> | null | undefined,
  drivingAxes: readonly FpKey[] = [],
): string {
  if (!fp) return "";

  // Rank axes by absolute distance from the neutral midpoint (0.5).
  // Prefer the caller's driving-axis order when supplied — the recommender
  // knows WHICH axes moved this wine into the negative basin — but still
  // fall through when the sign points at a non-complaint direction.
  const AXES = Object.keys(VERDICT_NEG) as FpKey[];
  const ordered: FpKey[] = drivingAxes.length
    ? [...drivingAxes, ...AXES.filter((k) => !drivingAxes.includes(k))]
    : [...AXES].sort((a, b) => Math.abs((fp[b] ?? 0.5) - 0.5) - Math.abs((fp[a] ?? 0.5) - 0.5));

  for (const axis of ordered) {
    const delta = (fp[axis] ?? 0.5) - 0.5;
    if (Math.abs(delta) < 0.10) continue; // ignore near-neutral
    const dir: AxisDir = delta > 0 ? "hi" : "lo";
    const phrase = VERDICT_NEG[axis][dir];
    if (phrase) return phrase;
  }
  return "";
}

// Runtime invariant: the two tables must agree on which directions ARE
// complaints. This trips on module load if the two ever drift out of sync.
// (Only the "which direction is a complaint" mapping must agree; the exact
// wording is intentionally allowed to differ per surface.)
(() => {
  for (const axis of Object.keys(VERDICT_NEG) as FpKey[]) {
    for (const dir of ["hi", "lo"] as const) {
      const v = VERDICT_NEG[axis][dir] !== "";
      const s = SOMMELIER_NEG[axis][dir] !== "";
      if (v !== s) {
        // eslint-disable-next-line no-console
        console.warn(
          `axis-phrases: complaint disagreement on ${axis}.${dir} — verdict=${v} sommelier=${s}`,
        );
      }
    }
  }
})();
