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
  distanceInContext,
  type TypeCtx,
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
  /** How many of those rated wines sit within one bandwidth of the candidate
   *  in ω-weighted style space. High = interpolation between wines we know;
   *  0 = the number is an extrapolation across a gap. Null when no context
   *  was fitted. Measurement only — nothing in scoring reads it. */
  neighborSupport: number | null;
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
  neighborSupport: null,
  nullReason: reason,
});

/**
 * Count the user's rated wines within one bandwidth of `target`, using the
 * SAME ω-weighted metric and the SAME h the recommender scored with — so the
 * support figure describes the geometry the prediction actually stood on.
 *
 * Read-only over an already-built context. No fit, no scoring change.
 */
export function neighborSupportOf(
  rated: RatedFp[],
  targetFp: Record<FpKey, number>,
  ctx: TypeCtx | null,
): number | null {
  if (!ctx) return null;
  let n = 0;
  for (const r of rated) {
    if (distanceInContext(targetFp, r.fp, ctx) <= ctx.h) n += 1;
  }
  return n;
}

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
    neighborSupport: neighborSupportOf(sameType, cand.fp, ctx),
    nullReason: null,
  };
}

/** Batch variant: one ω / h fit per colour for a whole scanned list, instead
 *  of one per candidate. Same numbers as `predictStars`, just not refitted
 *  forty times. */
export function predictStarsMany(
  rated: { bottle: FpRow; stars: number }[],
  targets: FpRow[],
): Map<string, PredictResult> {
  const out = new Map<string, PredictResult>();

  // Group candidates by colour; each colour gets its own independent palate.
  const byType = new Map<WineType, FpRow[]>();
  for (const t of targets) {
    if (out.has(t.id)) continue;
    if (!isFpCalibrated(t)) {
      out.set(t.id, noPrediction("uncalibrated_bottle"));
      continue;
    }
    const list = byType.get(typeOf(t)) ?? [];
    list.push(t);
    byType.set(typeOf(t), list);
  }

  for (const [type, list] of byType) {
    const rawSameType: (RatedFp & { vintage: number | null })[] = [];
    for (const r of rated) {
      const b = r.bottle;
      if (!b || typeOf(b) !== type || !isFpCalibrated(b)) continue;
      rawSameType.push({
        id: b.id, name: b.name, producer: b.producer, region: b.region,
        type, vintage: b.vintage, fp: fpOf(b), stars: r.stars,
      });
    }
    const sameType: RatedFp[] = aggregateRated(rawSameType).map((c) => ({
      id: c.id, name: c.name, producer: c.producer, region: c.region,
      type: c.type, fp: c.fp, stars: c.stars,
    }));

    if (sameType.length === 0) {
      for (const t of list) out.set(t.id, noPrediction("no_same_type_ratings"));
      continue;
    }
    if (sameType.length < MIN_RATINGS_FOR_PREDICTION) {
      for (const t of list) out.set(t.id, noPrediction("too_few_ratings", sameType.length));
      continue;
    }

    const ctx = buildTypeContext(sameType, type);
    const cands: BottleFp[] = list.map((t) => ({
      id: t.id, name: t.name, producer: t.producer, region: t.region,
      type, fp: fpOf(t),
    }));
    const recs = recommend(sameType, cands);
    const byId = new Map(recs.map((r) => [r.bottle.id, r]));
    for (const t of list) {
      const rec = byId.get(t.id);
      out.set(t.id, rec
        ? {
          predicted: rec.predicted,
          omega: ctx ? ({ ...ctx.fit.omega } as Record<FpKey, number>) : null,
          bandwidth: ctx ? ctx.h : null,
          nRated: sameType.length,
          neighborSupport: neighborSupportOf(sameType, fpOf(t), ctx),
          nullReason: null,
        }
        : noPrediction("no_same_type_ratings", sameType.length));
    }
  }

  return out;
}

