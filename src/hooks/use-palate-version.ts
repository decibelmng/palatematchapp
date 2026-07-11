import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";

/**
 * B2 — palate_version cascade.
 *
 * `profiles.palate_version` is a monotonically-increasing integer bumped
 * server-side by:
 *   • the `ratings_bump_palate_version` trigger (any insert/update/delete of
 *     a rating), and
 *   • `public.set_benchmark` (any Canon/Nemesis promote / demote / swap).
 *
 * Clients read it via this hook and use it as a cache key salt on every
 * palate-dependent query (matches, pour, scan, lanes, group_predict).
 * When something bumps the version, invalidating this query invalidates
 * every downstream query keyed on the returned value.
 *
 * Mutations that KNOW they bumped the version can call
 * `useApplyBumpedPalateVersion()` with the value returned from
 * `set_benchmark` — no round-trip needed.
 */
export function usePalateVersion() {
  const session = useSession();
  return useQuery({
    queryKey: ["palate-version", session?.user.id ?? null],
    enabled: !!session,
    staleTime: 10_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("palate_version")
        .eq("id", session!.user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as { palate_version?: number } | null)?.palate_version ?? 0;
    },
  });
}

/** Direct-write the palate-version cache with a value returned from a mutation
 *  (e.g. `set_benchmark`). Avoids an extra round-trip to `profiles`. */
export function useApplyBumpedPalateVersion() {
  const session = useSession();
  const qc = useQueryClient();
  return (nextVersion: number | null | undefined) => {
    if (nextVersion == null || !session) return;
    qc.setQueryData(["palate-version", session.user.id], nextVersion);
    // Downstream queries (canons, ratings, pour, matches, scan) either key on
    // palate_version directly or are invalidated by the mutations that call
    // this. Nothing more to do here.
  };
}
