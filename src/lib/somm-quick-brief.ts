/**
 * Lightweight sommelier "read a guest's palate in 10 seconds" brief.
 *
 * Built purely from the consent-gated scoring bundle (fingerprints + star
 * ratings + benchmark flags) — it does NOT need axis values or sweetness, so
 * it works today without touching the consent SQL. The richer, palate-code
 * brief (buildFullBrief) requires those and is a later parity upgrade.
 *
 * Pure functions — no data access — so the copy is unit-testable.
 */
import type { FpKey, RatedFp } from "@/lib/recommender";

export type QuickTypeBrief = {
  type: "red" | "white";
  /** One sensory sentence, e.g. "Leans silky, bright, and savory." */
  sensory: string;
  /** Benchmark wine names — the styles they reliably love, by name. */
  loves: string[];
  /** Dealbreaker wine names — steer away from these. */
  avoids: string[];
  ratedCount: number;
};

export type QuickBrief = { types: QuickTypeBrief[] };

const AXES: FpKey[] = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"];

/** Positive, preference-framed phrases (not complaints — cf. axis-phrases.ts).
 *  Empty string = that direction isn't worth calling out. */
const POS: Record<FpKey, { hi: string; lo: string }> = {
  tannin:     { hi: "structured", lo: "silky" },
  acid:       { hi: "bright, high-acid", lo: "round, soft" },
  body:       { hi: "full-bodied", lo: "light-bodied" },
  ripe:       { hi: "ripe and generous", lo: "restrained, savory" },
  oak:        { hi: "oak-touched", lo: "" },
  fruit_dark: { hi: "dark-fruited", lo: "" },
  fresh:      { hi: "fresh, lifted", lo: "" },
  savory:     { hi: "savory, earthy", lo: "" },
};

function joinList(items: string[]): string {
  const xs = items.filter((s) => s && s.trim().length > 0);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
}

function meanFp(wines: RatedFp[]): Record<FpKey, number> | null {
  if (wines.length === 0) return null;
  const sum = {} as Record<FpKey, number>;
  for (const a of AXES) sum[a] = 0;
  for (const w of wines) for (const a of AXES) sum[a] += w.fp[a] ?? 0.5;
  for (const a of AXES) sum[a] /= wines.length;
  return sum;
}

function sensoryLine(mean: Record<FpKey, number> | null): string {
  if (!mean) return "Not enough ratings yet to read a style.";
  const scored = AXES
    .map((a) => ({ a, d: mean[a] - 0.5 }))
    .filter((x) => Math.abs(x.d) >= 0.12)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const phrases: string[] = [];
  for (const { a, d } of scored) {
    const p = POS[a][d > 0 ? "hi" : "lo"];
    if (p) phrases.push(p);
    if (phrases.length >= 3) break;
  }
  if (phrases.length === 0) return "A balanced, middle-of-the-road style.";
  return `Leans ${joinList(phrases)}.`;
}

function names(wines: RatedFp[], max = 4): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of wines) {
    const n = (w.name ?? "").trim();
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** Build the quick brief from a guest's consent-gated rated fingerprints. */
export function buildGuestQuickBrief(rated: RatedFp[]): QuickBrief {
  const types: QuickTypeBrief[] = [];
  for (const type of ["red", "white"] as const) {
    const wines = rated.filter((r) => r.type === type);
    if (wines.length === 0) continue;
    const loved = wines.filter((r) => r.stars >= 4);
    types.push({
      type,
      sensory: sensoryLine(meanFp(loved.length > 0 ? loved : wines)),
      loves: names(wines.filter((r) => r.canon)),
      avoids: names(wines.filter((r) => r.nemesis)),
      ratedCount: wines.length,
    });
  }
  return { types };
}
