import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";
import type { AxisKey } from "@/lib/palate";
import type { FpKey } from "@/lib/recommender";

export type BottleRow = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  grape: string | null;
  vintage: number | null;
  fp_fresh: number; fp_acid: number; fp_tannin: number; fp_fruit_dark: number;
  fp_ripe: number; fp_oak: number; fp_body: number; fp_savory: number;
  ax_body: number; ax_fruit_char: number; ax_tannin: number; ax_acidity: number; ax_sweet: number;
};

const BOTTLE_COLS =
  "id,name,producer,region,grape,vintage,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet";

export function bottleToAx(b: BottleRow): Record<AxisKey, number> {
  return {
    body: b.ax_body,
    fruit_char: b.ax_fruit_char,
    tannin: b.ax_tannin,
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

export function useBottles() {
  return useQuery({
    queryKey: ["bottles"],
    queryFn: async (): Promise<BottleRow[]> => {
      const { data, error } = await supabase.from("bottles").select(BOTTLE_COLS).order("name");
      if (error) throw error;
      return (data ?? []) as BottleRow[];
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
      } else {
        const { error } = await supabase.from("ratings").upsert({
          user_id: session.user.id, bottle_id: bottleId, stars,
        }, { onConflict: "user_id,bottle_id" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ratings"] });
    },
  });
}

export function usePersistCode(code: string, nRated: number) {
  const session = useSession();
  const qc = useQueryClient();
  // Fire-and-forget: persist palate_code cache when it changes.
  useQueryEffect(session?.user.id, code, nRated, qc);
}

import { useEffect } from "react";
function useQueryEffect(uid: string | undefined, code: string, n: number, _qc: unknown) {
  useEffect(() => {
    if (!uid) return;
    supabase.from("profiles").upsert({ id: uid, palate_code: code, n_rated: n });
  }, [uid, code, n]);
}
