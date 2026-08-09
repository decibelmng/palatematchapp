// Pure bottle → palate-axis mapping.
//
// This lived in src/hooks/use-palate-data.ts, a client module, which is why the
// palate code could only ever be computed in the browser. It is pure data
// shaping with no React and no Supabase client, so both the client screens and
// the server recompute now import THIS, and the code math in src/lib/palate.ts
// has exactly one implementation.

import type { PaletteType } from "@/lib/palate";

export type WineType = "red" | "white" | "sparkling" | "rose" | "dessert";

/** Any row carrying the axis columns; the client BottleRow satisfies it. */
export type AxisSource = {
  type?: string | null;
  ax_body: number | null;
  ax_fruit_char: number | null;
  ax_tannin: number | null;
  ax_acidity: number | null;
  ax_sweet: number | null;
  fp_oak: number | null;
};

export function wineTypeOf(b: { type?: string | null }): WineType {
  const t = (b.type ?? "red").toLowerCase();
  if (t === "white" || t === "sparkling" || t === "rose" || t === "dessert") return t;
  return "red";
}

/**
 * Per-axis values for the requested palate's axis set. White's Oak slot reads
 * fp_oak (the fingerprint signal); red's third slot is tannin.
 *
 * Missing axes are OMITTED rather than defaulted — the missing-axis convention.
 * computeCode treats an absent value as no evidence for that slot.
 */
export function valuesForType(b: AxisSource, type: PaletteType): Record<string, number> {
  const out: Record<string, number> = {};
  const put = (k: string, v: number | null | undefined) => {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  };
  put("body", b.ax_body);
  put("fruit_char", b.ax_fruit_char);
  if (type === "red") put("tannin", b.ax_tannin);
  else put("oak", b.fp_oak);
  put("acidity", b.ax_acidity);
  put("sweet", b.ax_sweet);
  return out;
}

/** Columns the recompute needs. Kept next to the mapping so they can't drift. */
export const AXIS_SOURCE_COLS =
  "id,type,ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet,fp_oak";
