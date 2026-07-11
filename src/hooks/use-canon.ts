import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";
import { bottleType, type BottleRow } from "./use-palate-data";

export type CanonRow = {
  id: string;
  user_id: string;
  rating_id: string;
  bottle_id: string;
  region: string;
  region_key: string;
  wine_type: string;
  created_at: string;
  replaced_at: string | null;
};

// Normalize a bottle's wine type into the canon-scope value.
export function canonScopeType(b: Pick<BottleRow, "type">): "red" | "white" | "rose" | "sparkling" | "dessert" {
  return bottleType(b);
}

/** Active canons for the signed-in user (replaced_at IS NULL). */
export function useMyCanons() {
  const session = useSession();
  return useQuery({
    queryKey: ["canons", session?.user.id ?? null],
    enabled: !!session,
    staleTime: 30_000,
    queryFn: async (): Promise<CanonRow[]> => {
      const { data, error } = await (supabase as any)
        .from("canon_wines")
        .select("*")
        .eq("user_id", session!.user.id)
        .is("replaced_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CanonRow[];
    },
  });
}

export function usePromoteCanon() {
  const session = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      bottle: BottleRow;
      /** existing active canon for the same (region, type) if any — will be demoted */
      replace?: CanonRow | null;
    }) => {
      if (!session) throw new Error("Not signed in");
      const uid = session.user.id;
      const region = (args.bottle.region ?? "").trim();
      if (!region) throw new Error("Bottle has no region — cannot crown.");
      const wine_type = canonScopeType(args.bottle);

      // Ensure a rating row exists (Canon requires the user to have rated it).
      const { data: ratingRow, error: rErr } = await supabase
        .from("ratings")
        .select("id,stars")
        .eq("user_id", uid)
        .eq("bottle_id", args.bottle.id)
        .maybeSingle();
      if (rErr) throw rErr;
      if (!ratingRow) throw new Error("Rate this bottle before crowning it Canon.");

      if (args.replace) {
        const { error: dErr } = await (supabase as any)
          .from("canon_wines")
          .update({ replaced_at: new Date().toISOString() })
          .eq("id", args.replace.id);
        if (dErr) throw dErr;
      }

      const { data, error } = await (supabase as any)
        .from("canon_wines")
        .insert({
          user_id: uid,
          rating_id: ratingRow.id,
          bottle_id: args.bottle.id,
          region,
          wine_type,
        })
        .select()
        .single();
      if (error) throw error;
      return data as CanonRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canons"] });
    },
  });
}

export function useDemoteCanon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (canonId: string) => {
      const { error } = await (supabase as any)
        .from("canon_wines")
        .update({ replaced_at: new Date().toISOString() })
        .eq("id", canonId);
      if (error) throw error;
      return canonId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["canons"] });
    },
  });
}

/** Look up any active canon that would conflict with promoting this bottle. */
export function useCanonForScope(bottle: BottleRow | null | undefined) {
  const { data: canons } = useMyCanons();
  if (!bottle || !canons) return null;
  const region = (bottle.region ?? "").trim().toLowerCase();
  if (!region) return null;
  const type = canonScopeType(bottle);
  return canons.find((c) => c.region_key === region && c.wine_type === type) ?? null;
}
