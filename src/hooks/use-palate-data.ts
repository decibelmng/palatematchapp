import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";
import type { PaletteType } from "@/lib/palate";
import type { FpKey, WineType } from "@/lib/recommender";
import { refreshBottleFingerprint } from "@/lib/fingerprint-refresh.functions";

export type BottleRow = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  grape: string | null;
  vintage: number | null;
  type: string | null;
  critic_score: number | null;
  fp_fresh: number; fp_acid: number; fp_tannin: number; fp_fruit_dark: number;
  fp_ripe: number; fp_oak: number; fp_body: number; fp_savory: number;
  ax_body: number; ax_fruit_char: number; ax_tannin: number; ax_acidity: number; ax_sweet: number;
  tasting_note: string | null;
  source: string | null;
  added_by: string | null;
  price_band: string | null;
};

const BOTTLE_COLS =
  "id,name,producer,region,grape,vintage,type,critic_score,price_band,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet,tasting_note,source,added_by";

export function bottleType(b: BottleRow): WineType {
  const t = (b.type ?? "red").toLowerCase();
  if (t === "white" || t === "sparkling" || t === "rose" || t === "dessert") return t;
  return "red";
}
/** Build the per-axis value map for a bottle, using the requested palate type's
 *  axis set. White's Oak axis reads fp_oak (the fingerprint signal). */
export function bottleToValues(b: BottleRow, type: PaletteType): Record<string, number> {
  if (type === "red") {
    return {
      body: b.ax_body,
      fruit_char: b.ax_fruit_char,
      tannin: b.ax_tannin,
      acidity: b.ax_acidity,
      sweet: b.ax_sweet,
    };
  }
  return {
    body: b.ax_body,
    fruit_char: b.ax_fruit_char,
    oak: b.fp_oak,
    acidity: b.ax_acidity,
    sweet: b.ax_sweet,
  };
}
export function bottleToFp(b: BottleRow): Record<FpKey, number> {
  return {
    fresh: b.fp_fresh, acid: b.fp_acid, tannin: b.fp_tannin, fruit_dark: b.fp_fruit_dark,
    ripe: b.fp_ripe, oak: b.fp_oak, body: b.fp_body, savory: b.fp_savory,
  };
}

export function useBottlesByIds(ids: string[]) {
  const key = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["bottles", "byIds", key],
    enabled: ids.length > 0,
    queryFn: async (): Promise<BottleRow[]> => {
      const out: BottleRow[] = [];
      // chunk to keep URL length sane
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { data, error } = await supabase.from("bottles").select(BOTTLE_COLS).in("id", chunk);
        if (error) throw error;
        out.push(...((data ?? []) as BottleRow[]));
      }
      return out;
    },
    staleTime: 5 * 60_000,
  });
}

export function usePourCandidates() {
  const session = useSession();
  return useQuery({
    queryKey: ["pour-candidates", session?.user.id ?? null],
    enabled: !!session,
    queryFn: async (): Promise<BottleRow[]> => {
      const { getPourCandidates } = await import("@/lib/pour.functions");
      const res = await getPourCandidates();
      return (res.bottles ?? []) as BottleRow[];
    },
    staleTime: 5 * 60_000,
  });
}


export function useRatings() {
  const session = useSession();
  return useQuery({
    queryKey: ["ratings", session?.user.id ?? null],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ratings")
        .select("bottle_id,stars")
        .eq("user_id", session!.user.id);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 10_000,
  });
}

export function useRate() {
  const session = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bottleId, stars }: { bottleId: string; stars: number | null }) => {
      if (!session) throw new Error("Not signed in");
      if (stars === null) {
        const { error } = await supabase.from("ratings").delete()
          .eq("user_id", session.user.id).eq("bottle_id", bottleId);
        if (error) throw error;
        return { bottleId, stars };
      } else {
        const { error } = await supabase.from("ratings").upsert({
          user_id: session.user.id, bottle_id: bottleId, stars,
        }, { onConflict: "user_id,bottle_id" });
        if (error) throw error;
        return { bottleId, stars };
      }
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["ratings"] });
      // Self-healing: fire-and-forget cuvée re-fingerprint. The stamp in the
      // DB is the natural once-ever guard; failures/skips are silent.
      if (result?.stars !== null) {
        refreshBottleFingerprint({ data: { bottle_id: result.bottleId } })
          .then((r) => {
            if (r && "ok" in r && r.ok) {
              qc.invalidateQueries({ queryKey: ["bottles"] });
            }
          })
          .catch(() => {});
      }
    },
  });
}

export function usePersistCode(red: string, white: string, nRated: number) {
  const session = useSession();
  useCodeUpsert(session?.user.id, red, white, nRated);
}

import { useEffect } from "react";
function useCodeUpsert(uid: string | undefined, red: string, white: string, n: number) {
  useEffect(() => {
    if (!uid) return;
    supabase.from("profiles").update({
      palate_code: red,           // legacy column — keep populated with the red code
      palate_code_red: red,
      palate_code_white: white,
      n_rated: n,
    }).eq("id", uid);
  }, [uid, red, white, n]);
}

