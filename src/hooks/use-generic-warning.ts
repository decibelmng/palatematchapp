import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { bottleToFp, bottleType, isCalibrated, type BottleRow } from "./use-palate-data";

/** Empirically re-calibrated after the parameter-shadowing bug fix in
 *  rpc_fingerprint_reach. At h=0.30 the pool cleanly separates:
 *    Ch. Margaux Pavillon Rouge Barrel Sample 2012 → reach ≈ 0.184–0.198
 *    Shafer Hillside 2003 (Canon)                  → reach ≈ 0.022
 *    Pavillon Rouge 2011 (Canon)                   → reach ≈ 0.017
 *    Alex Gambal Vosne 2009 (Canon)                → reach ≈ 0.004
 *    Gaja Rossj-Bass                               → reach ≈ 0.000
 *  Threshold 0.10 sits ~5× above the strongest legit anchor and ~2× under
 *  the barrel sample. h=0.20 (the previous default) is too tight — every
 *  candidate scored under 0.5% and separation collapsed into noise. */
export const REACH_H = 0.30;
export const REACH_SAMPLE = 2000;
export const REACH_THRESHOLD = 0.10;

export type GenericVerdict =
  | { kind: "generic"; reach: number; threshold: number; h: number }
  | { kind: "uncalibrated" }
  | { kind: "ok"; reach: number; threshold: number; h: number };

/** A candidate is safe to reach-check only if its fingerprint is real.
 *  Bottles without an LLM-calibrated / harmonized / refingerprinted fp
 *  carry a `raw` flag from the pour pipeline; freshly-scanned or hand-added
 *  bottles may lack the flag but still have all axes at defaults or zeros.
 *  Reject both cases — the reach RPC on template data is garbage-in. */
function candidateHasRealFingerprint(bottle: BottleRow): boolean {
  const fp = bottleToFp(bottle);
  const anyMissing = Object.values(fp).some(
    (v) => v === null || v === undefined || !Number.isFinite(v),
  );
  if (anyMissing) return false;
  return isCalibrated(bottle);
}

/** Wine-level "generic fingerprint" check.
 *  Computes the fraction of the calibrated same-type pool sitting within
 *  uniform-ω distance `h` of the candidate. This is a property of the wine
 *  vs. the catalog, not the user — replaces distance-to-centroid, which
 *  conflated "catalog is dense here" with "fingerprint is undifferentiated." */
export function useGenericWarning() {
  const evaluate = useCallback(
    async (bottle: BottleRow): Promise<GenericVerdict | null> => {
      if (!candidateHasRealFingerprint(bottle)) {
        return { kind: "uncalibrated" };
      }
      const type = bottleType(bottle);
      const fp = bottleToFp(bottle);
      const { data, error } = await (supabase as any).rpc("rpc_fingerprint_reach", {
        p_fp_fresh: fp.fresh,
        p_fp_acid: fp.acid,
        p_fp_tannin: fp.tannin,
        p_fp_fruit_dark: fp.fruit_dark,
        p_fp_ripe: fp.ripe,
        p_fp_oak: fp.oak,
        p_fp_body: fp.body,
        p_fp_savory: fp.savory,
        p_wine_type: type,
        p_h: REACH_H,
        p_sample_size: REACH_SAMPLE,
      });
      if (error) return null;
      const reach = Number(data ?? 0);
      const base = { reach, threshold: REACH_THRESHOLD, h: REACH_H };
      return reach > REACH_THRESHOLD ? { kind: "generic", ...base } : { kind: "ok", ...base };
    },
    [],
  );

  /** True = safe to proceed (either not generic / uncalibrated, or user confirmed).
   *  Non-blocking window.confirm — cancel = no write, no version bump. */
  const confirmIfGeneric = useCallback(
    async (bottle: BottleRow): Promise<boolean> => {
      const v = await evaluate(bottle);
      if (!v) return true;
      if (typeof window === "undefined") return true;

      if (v.kind === "uncalibrated") {
        return window.confirm(
          "This wine doesn't have a calibrated fingerprint yet — as a benchmark " +
          "it would anchor your palate to estimated data. Crown anyway?",
        );
      }
      if (v.kind === "generic") {
        const pct = (v.reach * 100).toFixed(1);
        const thr = (v.threshold * 100).toFixed(1);
        return window.confirm(
          `This wine's profile looks generic in our catalog — ` +
          `its recommendations may be unfocused. Crown anyway?\n\n` +
          `(${pct}% of comparable wines sit within h=${v.h} of this fingerprint; ` +
          `threshold ${thr}%)`,
        );
      }
      return true;
    },
    [evaluate],
  );

  return { evaluate, confirmIfGeneric };
}
