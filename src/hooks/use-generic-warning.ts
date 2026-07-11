import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { bottleToFp, bottleType, type BottleRow } from "./use-palate-data";

/** Empirically calibrated on the red pool (2000-sample):
 *    barrel-sample (excluded)     reach = 0.031
 *    Pavillon Rouge (Canon)       reach = 0.002
 *    Shafer Hillside (Canon)      reach = 0.0035
 *    Gambal Vosne (Canon)         reach = 0.001
 *    Pignier Trousseau (Jura)     reach = 0.005    (savory outlier, passes)
 *  Threshold 0.015 sits 2× above the highest legit anchor and 2× below the barrel sample. */
export const REACH_H = 0.2;
export const REACH_SAMPLE = 2000;
export const REACH_THRESHOLD = 0.015;

export type GenericVerdict = {
  reach: number;
  threshold: number;
  h: number;
  generic: boolean;
};

/** Wine-level "generic fingerprint" check.
 *  Computes the fraction of the calibrated same-type pool sitting within
 *  uniform-ω distance `h` of the candidate. This is a property of the wine
 *  vs. the catalog, not the user — replaces distance-to-centroid, which
 *  conflated "catalog is dense here" with "fingerprint is undifferentiated." */
export function useGenericWarning() {
  const evaluate = useCallback(
    async (bottle: BottleRow): Promise<GenericVerdict | null> => {
      const type = bottleType(bottle);
      const fp = bottleToFp(bottle);
      const { data, error } = await (supabase as any).rpc("rpc_fingerprint_reach", {
        fp_fresh: fp.fresh,
        fp_acid: fp.acid,
        fp_tannin: fp.tannin,
        fp_fruit_dark: fp.fruit_dark,
        fp_ripe: fp.ripe,
        fp_oak: fp.oak,
        fp_body: fp.body,
        fp_savory: fp.savory,
        wine_type: type,
        h: REACH_H,
        sample_size: REACH_SAMPLE,
      });
      if (error) return null;
      const reach = Number(data ?? 0);
      return {
        reach,
        threshold: REACH_THRESHOLD,
        h: REACH_H,
        generic: reach > REACH_THRESHOLD,
      };
    },
    [],
  );

  /** True = safe to proceed (either not generic, or user confirmed).
   *  Non-blocking window.confirm — cancel = no write, no version bump. */
  const confirmIfGeneric = useCallback(
    async (bottle: BottleRow): Promise<boolean> => {
      const v = await evaluate(bottle);
      if (!v || !v.generic) return true;
      const pct = (v.reach * 100).toFixed(1);
      const thr = (v.threshold * 100).toFixed(1);
      const msg =
        `This wine's profile looks generic in our catalog — ` +
        `its recommendations may be unfocused. Crown anyway?\n\n` +
        `(${pct}% of comparable wines sit within h=${v.h} of this fingerprint; ` +
        `threshold ${thr}%)`;
      return typeof window !== "undefined" ? window.confirm(msg) : true;
    },
    [evaluate],
  );

  return { evaluate, confirmIfGeneric };
}
