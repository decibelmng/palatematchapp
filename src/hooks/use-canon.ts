import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";
import { bottleType, type BottleRow } from "./use-palate-data";

export type BenchmarkTier = "canon" | "nemesis";

export type CanonRow = {
  id: string;
  user_id: string;
  rating_id: string;
  bottle_id: string;
  region: string;
  region_key: string;
  wine_type: string;
  tier: BenchmarkTier;
  created_at: string;
  replaced_at: string | null;
};

function normalizeBenchmarkTier(tier: unknown): BenchmarkTier | null {
  if (tier === "canon" || tier === "nemesis") return tier;
  return null;
}

export function isCanonBenchmark(row: Pick<CanonRow, "tier">): boolean {
  return row.tier === "canon";
}

export function isNemesisBenchmark(row: Pick<CanonRow, "tier">): boolean {
  return row.tier === "nemesis";
}

export function findBenchmarkForBottle(
  benchmarks: CanonRow[] | null | undefined,
  bottleId: string,
  tier: BenchmarkTier,
): CanonRow | null {
  return (benchmarks ?? []).find((c) => c.bottle_id === bottleId && c.tier === tier) ?? null;
}

// Normalize a bottle's wine type into the canon-scope value.
export function canonScopeType(b: Pick<BottleRow, "type">): "red" | "white" | "rose" | "sparkling" | "dessert" {
  return bottleType(b as BottleRow);
}

/** Active benchmarks (canon + nemesis) for the signed-in user. */
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
      return ((data ?? []) as any[])
        .map((r) => {
          const normalizedTier = normalizeBenchmarkTier(r.tier);
          return normalizedTier ? ({ ...r, tier: normalizedTier } as CanonRow) : null;
        })
        .filter((r): r is CanonRow => r !== null);
    },
  });
}

/** Convenience: only Canons. */
export function useMyCanonsOnly() {
  const { data, ...rest } = useMyCanons();
  return { ...rest, data: (data ?? []).filter((c) => c.tier === "canon") };
}

/** Convenience: only Nemeses. */
export function useMyNemeses() {
  const { data, ...rest } = useMyCanons();
  return { ...rest, data: (data ?? []).filter((c) => c.tier === "nemesis") };
}

/** Pure guard: throws if a (tier, stars) pair violates the promotion rules.
 *  Mirrors the DB trigger `canon_wines_validate_tier` so client failures
 *  match server failures. Exported for unit tests. */
export function validateBenchmarkPromotion(tier: BenchmarkTier, stars: number): void {
  if (tier !== "canon" && tier !== "nemesis") {
    throw new Error(`Invalid tier: ${tier}`);
  }
  if (tier === "canon" && stars < 5) {
    throw new Error("Only 5★ wines can become a Canon.");
  }
  if (tier === "nemesis" && stars > 2) {
    throw new Error("Only 1★ or 2★ wines can become a Nemesis.");
  }
}

function usePromoteBenchmark(tier: BenchmarkTier) {
  const session = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      bottle: BottleRow;
      /** existing active benchmark of THIS tier for the same (region, type), if any — will be demoted */
      replace?: CanonRow | null;
    }) => {
      if (!session) throw new Error("Not signed in");
      const uid = session.user.id;
      const region = (args.bottle.region ?? "").trim();
      if (!region) throw new Error(`Bottle has no region — cannot ${tier === "canon" ? "crown" : "mark as Nemesis"}.`);
      const wine_type = canonScopeType(args.bottle);

      // Ensure a rating row exists AND satisfies the tier's star gate.
      const { data: ratingRow, error: rErr } = await supabase
        .from("ratings")
        .select("id,stars")
        .eq("user_id", uid)
        .eq("bottle_id", args.bottle.id)
        .maybeSingle();
      if (rErr) throw rErr;
      if (!ratingRow) throw new Error(`Rate this bottle before ${tier === "canon" ? "crowning" : "marking"} it.`);
      validateBenchmarkPromotion(tier, ratingRow.stars);

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
          tier,
        })
        .select()
        .single();
      if (error) throw error;
      return data as CanonRow;
    },
    onSuccess: (row, args) => {
      const benchmark = { ...row, tier } satisfies CanonRow;
      qc.setQueriesData<CanonRow[]>({ queryKey: ["canons"] }, (old) => {
        if (!old) return [benchmark];
        return [
          benchmark,
          ...old.filter((c) => c.id !== benchmark.id && c.id !== args.replace?.id),
        ];
      });
      qc.invalidateQueries({ queryKey: ["canons"] });
    },
  });
}

export function usePromoteCanon() {
  return usePromoteBenchmark("canon");
}

export function usePromoteNemesis() {
  return usePromoteBenchmark("nemesis");
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
      qc.setQueriesData<CanonRow[]>({ queryKey: ["canons"] }, (old) => old?.filter((c) => c.id !== canonId));
      qc.invalidateQueries({ queryKey: ["canons"] });
    },
  });
}

/** Same underlying demote path for a Nemesis row; kept as a named export for clarity at call sites. */
export const useDemoteNemesis = useDemoteCanon;

/** Look up any active benchmark of the given tier that would conflict with promoting this bottle. */
export function useCanonForScope(bottle: BottleRow | null | undefined, tier: BenchmarkTier = "canon") {
  const { data: canons } = useMyCanons();
  if (!bottle || !canons) return null;
  const region = (bottle.region ?? "").trim().toLowerCase();
  if (!region) return null;
  const type = canonScopeType(bottle);
  return canons.find((c) => c.tier === tier && c.region_key === region && c.wine_type === type) ?? null;
}

export function useNemesisForScope(bottle: BottleRow | null | undefined) {
  return useCanonForScope(bottle, "nemesis");
}
