import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FpKey, WineType } from "@/lib/recommender";

export type TypeCentroids = Partial<Record<WineType, Record<FpKey, number>>>;

/** Fetches the per-type average fingerprint across the calibrated catalog.
 *  Server aggregates ~120k rows into 5; the client caches for the session. */
export function useTypeCentroids() {
  return useQuery({
    queryKey: ["type-centroids"],
    staleTime: 60 * 60_000, // 1h — centroids drift very slowly
    queryFn: async (): Promise<TypeCentroids> => {
      const { data, error } = await (supabase as any).rpc("rpc_type_centroids");
      if (error) throw error;
      const out: TypeCentroids = {};
      for (const row of (data ?? []) as any[]) {
        const t = String(row.type).toLowerCase();
        if (t !== "red" && t !== "white" && t !== "sparkling" && t !== "rose" && t !== "dessert") continue;
        out[t as WineType] = {
          fresh: Number(row.fresh),
          acid: Number(row.acid),
          tannin: Number(row.tannin),
          fruit_dark: Number(row.fruit_dark),
          ripe: Number(row.ripe),
          oak: Number(row.oak),
          body: Number(row.body),
          savory: Number(row.savory),
        };
      }
      return out;
    },
  });
}
