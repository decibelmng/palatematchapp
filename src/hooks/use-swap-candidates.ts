import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";
import { usePalateVersion } from "./use-palate-version";
import type { BottleRow } from "./use-palate-data";
import type { BenchmarkTier } from "./use-canon";

const BOTTLE_COLS =
  "id,name,producer,region,grape,vintage,type,critic_score,price_band,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet,tasting_note,source,added_by,excluded_from_recs";

/**
 * B3 — eligible swap candidates for a given benchmark slot.
 *
 * Returns the signed-in user's ratings whose stars match the tier's gate
 * (5 for canon, 1–2 for nemesis), whose bottle sits in the same
 * region_key + wine_type as the current benchmark, and which are not the
 * currently-crowned bottle.
 *
 * Result is keyed on `palate_version` so it refreshes whenever anything
 * palate-changing happens (new rating, swap, demote).
 */
export function useEligibleSwapCandidates(args: {
  tier: BenchmarkTier;
  regionKey: string;
  wineType: string;
  excludeBottleId?: string;
  enabled?: boolean;
}) {
  const session = useSession();
  const { data: palateVersion } = usePalateVersion();
  const stars = args.tier === "canon" ? [5] : [1, 2];
  const enabled = (args.enabled ?? true) && !!session && !!args.regionKey && !!args.wineType;

  return useQuery({
    queryKey: [
      "swap-candidates",
      session?.user.id ?? null,
      args.tier,
      args.regionKey,
      args.wineType,
      args.excludeBottleId ?? null,
      palateVersion ?? 0,
    ],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<BottleRow[]> => {
      // Pull all star-matching ratings for the user in one query, then
      // filter client-side by region_key + type. Even for prolific raters
      // the star-gated set is small (canon: only 5★).
      const { data: ratings, error: rErr } = await supabase
        .from("ratings")
        .select("bottle_id, stars")
        .eq("user_id", session!.user.id)
        .in("stars", stars);
      if (rErr) throw rErr;
      const ids = (ratings ?? []).map((r) => r.bottle_id);
      if (ids.length === 0) return [];

      const out: BottleRow[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { data, error } = await supabase
          .from("bottles")
          .select(BOTTLE_COLS)
          .in("id", chunk)
          .eq("excluded_from_recs", false);
        if (error) throw error;
        out.push(...((data ?? []) as unknown as BottleRow[]));
      }

      const wantType = args.wineType.toLowerCase();
      const wantRegion = args.regionKey.toLowerCase();
      return out
        .filter((b) => (b.type ?? "").toLowerCase() === wantType)
        .filter((b) => (b.region ?? "").trim().toLowerCase() === wantRegion)
        .filter((b) => b.id !== args.excludeBottleId)
        .sort((a, b) => {
          // stable order: vintage desc, then name
          const va = a.vintage ?? 0;
          const vb = b.vintage ?? 0;
          if (vb !== va) return vb - va;
          return (a.name ?? "").localeCompare(b.name ?? "");
        });
    },
  });
}
