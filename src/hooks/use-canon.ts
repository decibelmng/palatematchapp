import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";
import { bottleType, type BottleRow } from "./use-palate-data";
import { useApplyBumpedPalateVersion, usePalateVersion } from "./use-palate-version";

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

/** Active benchmarks (canon + nemesis) for the signed-in user.
 *  Keyed on `palate_version` so any B1/B2 mutation (promote / demote / swap /
 *  rating-edit cascade) triggers an automatic refetch. */
export function useMyCanons() {
  const session = useSession();
  const { data: palateVersion } = usePalateVersion();
  return useQuery({
    queryKey: ["canons", session?.user.id ?? null, palateVersion ?? 0],
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

/** Friendly re-throw for the `EXCLUDED_BOTTLE:` sentinel raised by the
 *  `canon_wines_validate_tier` trigger when a barrel sample is promoted. */
function friendlyPromotionError(err: unknown): Error {
  const msg = (err as { message?: string } | null)?.message ?? String(err);
  if (msg.includes("EXCLUDED_BOTTLE")) {
    return new Error("Barrel samples can't be benchmarks — crown the finished wine instead.");
  }
  return err instanceof Error ? err : new Error(msg);
}

/** Shape returned by the `set_benchmark` RPC (B1). */
type SetBenchmarkResult = {
  benchmark_id: string | null;
  replaced_id: string | null;
  palate_version: number;
};

async function callSetBenchmark(args: {
  bottleId: string;
  tier: BenchmarkTier;
  action: "promote" | "demote" | "demote-on-rating";
}): Promise<SetBenchmarkResult> {
  const { data, error } = await (supabase as any).rpc("set_benchmark", {
    p_bottle_id: args.bottleId,
    p_tier: args.tier,
    p_action: args.action,
  });
  if (error) throw friendlyPromotionError(error);
  // Postgres TABLE-returning functions come back as an array of rows.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("set_benchmark returned no row");
  return row as SetBenchmarkResult;
}

function usePromoteBenchmark(tier: BenchmarkTier) {
  const session = useSession();
  const qc = useQueryClient();
  const applyVersion = useApplyBumpedPalateVersion();
  return useMutation({
    mutationFn: async (args: {
      bottle: BottleRow;
      /** kept for API compatibility; server-side swap handles this atomically now */
      replace?: CanonRow | null;
    }) => {
      if (!session) throw new Error("Not signed in");
      const region = (args.bottle.region ?? "").trim();
      if (!region) throw new Error(`Bottle has no region — cannot ${tier === "canon" ? "crown" : "mark as Nemesis"}.`);

      // Client-side guard — server enforces regardless via set_benchmark.
      if ((args.bottle as { excluded_from_recs?: boolean }).excluded_from_recs) {
        throw new Error("Barrel samples can't be benchmarks — crown the finished wine instead.");
      }

      const res = await callSetBenchmark({
        bottleId: args.bottle.id,
        tier,
        action: "promote",
      });
      return res;
    },
    onSuccess: (res) => {
      applyVersion(res.palate_version);
      // palate_version bump auto-refetches the canons query; still invalidate
      // for safety and to catch any queries not yet keyed on the version.
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

/** Demote a benchmark by its bottle id + tier. The RPC atomically bumps
 *  palate_version so downstream queries refresh. */
export function useDemoteCanon() {
  const qc = useQueryClient();
  const applyVersion = useApplyBumpedPalateVersion();
  return useMutation({
    mutationFn: async (input: string | { canonId?: string; bottleId: string; tier: BenchmarkTier }) => {
      // Back-compat: legacy callers pass a canon row id. We look up its
      // (bottle_id, tier) so we can route through the RPC.
      let bottleId: string;
      let tier: BenchmarkTier = "canon";
      if (typeof input === "string") {
        const { data, error } = await (supabase as any)
          .from("canon_wines")
          .select("bottle_id,tier")
          .eq("id", input)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("Benchmark row not found");
        bottleId = data.bottle_id;
        const t = normalizeBenchmarkTier(data.tier);
        if (!t) throw new Error(`Unknown tier on benchmark row: ${data.tier}`);
        tier = t;
      } else {
        bottleId = input.bottleId;
        tier = input.tier;
      }
      return callSetBenchmark({ bottleId, tier, action: "demote" });
    },
    onSuccess: (res) => {
      applyVersion(res.palate_version);
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
