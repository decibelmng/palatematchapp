/** Pure prediction core — shared by the client cache path and the server
 *  fallback so both produce the SAME number from the same inputs.
 *
 *  No React, no Supabase, no browser globals: safe to import in a server
 *  function handler and in a hook.
 *
 *  This changes no scoring math. It calls `recommend` and reads ω / h back out
 *  through the public `buildTypeContext` helper purely so the outcome log can
 *  record which model state produced the number. Engine invariants (per-axis
 *  ridge, red/white separation, adaptive bandwidth, basin veto) are untouched.
 */
import {
  recommend,
  buildTypeContext,
  type BottleFp,
  type FpKey,
  type RatedFp,
  type WineType,
} from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";

/** Minimum same-colour ratings before we'll put a number on a wine. */
export const MIN_RATINGS_FOR_PREDICTION = 3;

export type FpRow = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  vintage: number | null;
  type: string | null;
  fp_fresh: number | null;
  fp_acid: number | null;
  fp_tannin: number | null;
  fp_fruit_dark: number | null;
  fp_ripe: number | null;
  fp_oak: number | null;
  fp_body: number | null;
  fp_savory: number | null;
};

/** Reasons a prediction could not be made. Mirrors the DB check constraint on
 *  prediction_outcomes.null_reason — missingness has to be countable, not a
 *  silently absent row. */
export type PredictNullReason =
  | "uncalibrated_bottle"
  | "too_few_ratings"
  | "no_same_type_ratings"
  | "fetch_failed"
  | "not_attempted";

export type PredictResult = {
  predicted: number | null;
  omega: Record<FpKey, number> | null;
  bandwidth: number | null;
  /** Same-colour cuvée-aggregated ratings the prediction was made from. */
  nRated: number;
  nullReason: PredictNullReason | null;
};

export function fpOf(b: FpRow): Record<FpKey, number> {
  return {
    fresh: b.fp_fresh ?? 0,
    acid: b.fp_acid ?? 0,
    tannin: b.fp_tannin ?? 0,
    fruit_dark: b.fp_fruit_dark ?? 0,
    ripe: b.fp_ripe ?? 0,
    oak: b.fp_oak ?? 0,
    body: b.fp_body ?? 0,
    savory: b.fp_savory ?? 0,
  };
}

export function typeOf(b: FpRow): WineType {
  const t = (b.type ?? "red").toLowerCase();
  if (t === "white" || t === "sparkling" || t === "rose" || t === "dessert") return t;
  return "red";
}

/** A calibrated bottle has at least one non-zero axis. A whole-zero vector is
 *  indistinguishable from "never fingerprinted", so it is treated as absent. */
export function isFpCalibrated(b: FpRow | null | undefined): boolean {
  if (!b) return false;
  if (b.fp_fresh === null || b.fp_fresh === undefined) return false;
  return Object.values(fpOf(b)).some((v) => Number.isFinite(v) && v !== 0);
}

const noPrediction = (reason: PredictNullReason, nRated = 0): PredictResult => ({
  predicted: null,
  omega: null,
  bandwidth: null,
  nRated,
  nullReason: reason,
});

/**
 * Predict stars for `target` from the user's rated bottles.
 *
 * Red and white are never blended: only same-colour ratings enter the context,
 * exactly as the on-screen recommender does it.
 */
export function predictStars(
  rated: { bottle: FpRow; stars: number }[],
  target: FpRow,
): PredictResult {
  if (!isFpCalibrated(target)) return noPrediction("uncalibrated_bottle");

  const targetType = typeOf(target);
  const rawSameType: (RatedFp & { vintage: number | null })[] = [];
  for (const r of rated) {
    const b = r.bottle;
    if (!b) continue;
    if (typeOf(b) !== targetType) continue;
    if (!isFpCalibrated(b)) continue;
    rawSameType.push({
      id: b.id,
      name: b.name,
      producer: b.producer,
      region: b.region,
      type: typeOf(b),
      vintage: b.vintage,
      fp: fpOf(b),
      stars: r.stars,
    });
  }
  if (rawSameType.length === 0) return noPrediction("no_same_type_ratings");

  // Vintage-aware, cuvée-aggregated: derived for neighbour logic only.
  const cuvees = aggregateRated(rawSameType);
  const sameType: RatedFp[] = cuvees.map((c) => ({
    id: c.id,
    name: c.name,
    producer: c.producer,
    region: c.region,
    type: c.type,
    fp: c.fp,
    stars: c.stars,
  }));

  if (sameType.length < MIN_RATINGS_FOR_PREDICTION) {
    return noPrediction("too_few_ratings", sameType.length);
  }

  const cand: BottleFp = {
    id: target.id,
    name: target.name,
    producer: target.producer,
    region: target.region,
    type: targetType,
    fp: fpOf(target),
  };
  const [rec] = recommend(sameType, [cand]);
  if (!rec) return noPrediction("no_same_type_ratings", sameType.length);

  const ctx = buildTypeContext(sameType, targetType);
  return {
    predicted: rec.predicted,
    omega: ctx ? ({ ...ctx.fit.omega } as Record<FpKey, number>) : null,
    bandwidth: ctx ? ctx.h : null,
    nRated: sameType.length,
    nullReason: null,
  };
}

/** Batch variant: one context build per colour, for a whole scanned list. */
export function predictStarsMany(
  rated: { bottle: FpRow; stars: number }[],
  targets: FpRow[],
): Map<string, PredictResult> {
  const out = new Map<string, PredictResult>();
  for (const t of targets) {
    if (out.has(t.id)) continue;
    out.set(t.id, predictStars(rated, t));
  }
  return out;
}
