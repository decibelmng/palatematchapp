import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";
import type { PaletteType } from "@/lib/palate";
import { recommend, type BottleFp, type FpKey, type RatedFp, type WineType } from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";
import { predictStars, type FpRow, type PredictResult } from "@/lib/predict-core";
import { predictStarsForBottle } from "@/lib/predict.functions";
import { refreshBottleFingerprint } from "@/lib/fingerprint-refresh.functions";
import { usePalateVersion } from "./use-palate-version";
import { confirmDialog } from "@/components/confirm-dialog";
import { askMissAttribution } from "@/components/MissFollowUp";
import { createElement, Fragment } from "react";




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
  price_band: string | null;
  raw?: boolean;                    // true = no calibrated fingerprint (LLM/harmonized/refingerprinted all absent)
};

const BOTTLE_COLS =
  "id,name,producer,region,grape,vintage,type,critic_score,price_band,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet,tasting_note,source";

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

/** True when the bottle has calibrated fingerprint axes (not defaults). */
export function isCalibrated(b: BottleRow | null | undefined): boolean {
  if (!b) return false;
  if ((b as { raw?: boolean }).raw) return false;
  // Server gate is `fp_fresh IS NOT NULL`; client BottleRow types it as number,
  // so we conservatively treat 0-vector as uncalibrated too.
  const fp = bottleToFp(b);
  return Object.values(fp).some((v) => Number.isFinite(v) && v !== 0);
}

/** Gather the user's rated bottles from cache.
 *  `complete` is false when any rated bottle is missing from the cache — the
 *  caller must then ask the server rather than predicting from a partial set,
 *  which is what used to silently produce a null prediction. */
function ratedFromCache(qc: QueryClient, userId: string): {
  rated: { bottle: FpRow; stars: number }[];
  complete: boolean;
  nRatings: number;
} {
  const ratings = qc
    .getQueriesData<{ bottle_id: string; stars: number }[]>({ queryKey: ["ratings", userId] })
    .flatMap(([, data]) => data ?? []);

  const allBottles = qc
    .getQueriesData<BottleRow[]>({ queryKey: ["bottles"] })
    .flatMap(([, data]) => data ?? []);
  const bottleById = new Map<string, BottleRow>();
  for (const b of allBottles) if (b?.id) bottleById.set(b.id, b);

  const rated: { bottle: FpRow; stars: number }[] = [];
  let missing = 0;
  for (const r of ratings) {
    const b = bottleById.get(r.bottle_id);
    if (!b) { missing += 1; continue; }
    rated.push({ bottle: b as unknown as FpRow, stars: r.stars });
  }
  return { rated, complete: ratings.length > 0 && missing === 0, nRatings: ratings.length };
}

/** Wine name from whatever bottles query is already cached — never truncated,
 *  and "this wine" only when nothing is cached. */
function bottleNameFor(qc: QueryClient, bottleId: string): string {
  const hit = qc
    .getQueriesData<BottleRow[]>({ queryKey: ["bottles"] })
    .flatMap(([, data]) => data ?? [])
    .find((b) => !!b && b.id === bottleId);
  return hit?.name ?? "this wine";
}

/** Predict from cache when the cache is sufficient; otherwise report that the
 *  caller should fall back to the server. Never returns a bare null. */
export function predictForBottleFromCache(
  qc: QueryClient,
  userId: string,
  target: BottleRow,
): PredictResult & { needsServer: boolean } {
  const { rated, complete } = ratedFromCache(qc, userId);
  if (!complete) {
    return {
      predicted: null, omega: null, bandwidth: null, nRated: rated.length,
      neighborSupport: null, axisDeltas: null, nullReason: "not_attempted", needsServer: true,
    };
  }
  const res = predictStars(rated, target as unknown as FpRow);
  // A partial cache can masquerade as "too few ratings"; verify on the server.
  const needsServer = res.predicted === null && res.nullReason !== "uncalibrated_bottle";
  return { ...res, needsServer };
}

/** Cache-first, server-fallback prediction. Always resolves to a result with
 *  either a number or a recorded reason there isn't one. */
export async function predictForBottleWithFallback(
  qc: QueryClient,
  userId: string,
  bottleId: string,
): Promise<PredictResult> {
  const cachedTarget = qc
    .getQueriesData<BottleRow[]>({ queryKey: ["bottles"] })
    .flatMap(([, data]) => data ?? [])
    .find((b): b is BottleRow => !!b && b.id === bottleId) ?? null;

  if (cachedTarget) {
    const fromCache = predictForBottleFromCache(qc, userId, cachedTarget);
    if (!fromCache.needsServer) {
      const { needsServer: _drop, ...rest } = fromCache;
      return rest;
    }
  }

  try {
    return await predictStarsForBottle({ data: { bottle_id: bottleId } });
  } catch {
    return {
      predicted: null, omega: null, bandwidth: null, nRated: 0,
      neighborSupport: null, axisDeltas: null, nullReason: "fetch_failed",
    };
  }
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
  const { data: palateVersion } = usePalateVersion();
  return useQuery({
    queryKey: ["pour-candidates", session?.user.id ?? null, palateVersion ?? 0],
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
  const { data: palateVersion } = usePalateVersion();
  return useQuery({
    queryKey: ["ratings", session?.user.id ?? null, palateVersion ?? 0],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ratings")
        .select("bottle_id,stars,note")
        .eq("user_id", session!.user.id);
      if (error) throw error;
      return (data ?? []) as { bottle_id: string; stars: number; note: string | null }[];
    },
    staleTime: 10_000,
  });
}

/** Sentinel error thrown when the user cancels the cascade confirm dialog. */
export class RateCanceledError extends Error {
  constructor() { super("Rating change canceled"); this.name = "RateCanceledError"; }
}

type RateInput = {
  bottleId: string;
  stars: number | null;
  /** Optional confirm hook: if the DB would demote a benchmark as a side effect
   *  of this rating change, this is called with the tier + region + bottle name.
   *  Return true to proceed, false to cancel. Defaults to window.confirm. */
  onCascadeConfirm?: (info: { tier: "canon" | "nemesis"; region: string; bottleName: string }) => boolean | Promise<boolean>;
  /** Where the rating came from, for the prediction-accuracy log. */
  source?: "scan_list" | "scan_bottle" | "rate_screen" | "undo" | "somm" | "other";
  scanId?: string | null;
  scanWineId?: string | null;
  /** 1 = this was the Call. A miss on rank 1 matters more than on rank 34. */
  predictedRank?: number | null;
};


type RateResult = {
  bottleId: string;
  stars: number | null;
  demotedTier: "canon" | "nemesis" | null;
  previousStars: number | null;
  palateVersion: number | null;
  /** The measurement row this rating just wrote, so the one follow-up question
   *  can attach its answer to it. Null when nothing was logged (rating cleared). */
  outcomeId: string | null;
  /** Signed: rated minus expected. Null when we had no expectation to miss. */
  delta: number | null;
  bottleName: string;
};

export function useRate() {
  const session = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bottleId, stars, onCascadeConfirm, source, scanId, scanWineId, predictedRank }: RateInput): Promise<RateResult> => {
      if (!session) throw new Error("Not signed in");

      // Check whether this rating change would trigger a benchmark demote.
      // Read canons snapshot from cache — freshness is guaranteed by
      // palate_version keying (see useMyCanons).
      const canons = qc.getQueriesData<{ bottle_id: string; tier: "canon" | "nemesis"; region: string }[]>({
        queryKey: ["canons"],
      })
        .flatMap(([, data]) => (data ?? []))
        .filter(Boolean);

      const active = canons.find(
        (c) => c.bottle_id === bottleId &&
          (stars === null
            || (c.tier === "canon" && stars < 5)
            || (c.tier === "nemesis" && stars > 2)),
      );

      if (active) {
        // Pull bottle name for the prompt from any cached bottles query.
        const cachedBottles = qc.getQueriesData<BottleRow[]>({ queryKey: ["bottles"] })
          .flatMap(([, data]) => (data ?? []))
          .filter((b): b is BottleRow => !!b && b.id === bottleId);
        const bottleName = cachedBottles[0]?.name ?? "this wine";

        const confirmFn = onCascadeConfirm ?? (({ tier, region, bottleName }) => {
          const verb = tier === "canon"
            ? `You'd set this as a benchmark in ${region}. Lowering the rating removes that.`
            : `You'd marked this as a dealbreaker in ${region}. Raising the rating removes that.`;
          return confirmDialog({
            title: tier === "canon" ? "Remove as a benchmark?" : "Remove as a dealbreaker?",


            description: createElement(
              Fragment,
              null,
              createElement("p", null, verb),
              createElement(
                "p",
                { className: "mt-3" },
                "Continue and update ",
                createElement(
                  "span",
                  { className: "font-semibold text-foreground" },
                  bottleName,
                ),
                "?",
              ),
            ),
            confirmLabel: "Continue",
            destructive: true,
          });
        });



        const ok = await confirmFn({ tier: active.tier, region: active.region, bottleName });
        if (!ok) throw new RateCanceledError();
      }

      // Predict against pre-rating palate state. Cache first, server fallback:
      // a rating from a screen that never loaded the rated set used to log
      // nothing, which quietly biased the record toward measurable cases.
      const p = await predictForBottleWithFallback(qc, session.user.id, bottleId);

      const { data, error } = await (supabase as any).rpc("save_rating_with_cascade", {
        p_bottle_id: bottleId,
        p_stars: stars,
        p_predicted: p.predicted,
        p_omega: p.omega,
        p_bandwidth: p.bandwidth,
        p_n_rated: p.nRated,
        p_source: source ?? "other",
        p_scan_id: scanId ?? null,
        p_scan_wine_id: scanWineId ?? null,
        p_predicted_rank: predictedRank ?? null,
        p_null_reason: p.nullReason,
        p_neighbor_support: p.neighborSupport,
        p_axis_deltas: p.axisDeltas,
      });
      if (error) throw error;


      const row = Array.isArray(data) ? data[0] : data;
      return {
        bottleId,
        stars,
        demotedTier: (row?.demoted_tier ?? null) as "canon" | "nemesis" | null,
        previousStars: (row?.previous_stars ?? null) as number | null,
        palateVersion: (row?.palate_version ?? null) as number | null,
        // For the one inline follow-up question after a big miss.
        outcomeId: (row?.outcome_id ?? null) as string | null,
        delta: (row?.delta ?? null) as number | null,
        bottleName: bottleNameFor(qc, bottleId),
      };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["ratings"] });
      qc.invalidateQueries({ queryKey: ["palate-version"] });
      // A full star or more off: ask which half of the system was wrong.
      // askMissAttribution ignores anything smaller, so no gate is needed here.
      if (result?.outcomeId && result.delta != null) {
        askMissAttribution({
          outcomeId: result.outcomeId,
          delta: result.delta,
          wineName: result.bottleName,
        });
      }
      if (result?.demotedTier) {
        qc.invalidateQueries({ queryKey: ["canons"] });
        // 10s undo — restores rating + benchmark in one atomic RPC (+1 version bump).
        const verb = result.demotedTier === "canon" ? "Benchmark" : "Dealbreaker";
        toast(`${verb} status removed (rating changed).`, {

          duration: 10_000,
          action: {
            label: "Undo",
            onClick: async () => {
              if (result.previousStars == null) {
                toast.error("No previous rating to restore.");
                return;
              }
              // A restore logs its own outcome row. The retracted stars are
              // already in the log; without this the considered judgment — the
              // one we most want to measure — was the one that went missing.
              const up = session
                ? await predictForBottleWithFallback(qc, session.user.id, result.bottleId)
                : null;
              const { error } = await (supabase as any).rpc("restore_rating_and_benchmark", {
                p_bottle_id: result.bottleId,
                p_stars: result.previousStars,
                p_tier: result.demotedTier,
                p_predicted: up?.predicted ?? null,
                p_omega: up?.omega ?? null,
                p_bandwidth: up?.bandwidth ?? null,
                p_n_rated: up?.nRated ?? null,
                p_null_reason: up ? up.nullReason : "fetch_failed",
                p_neighbor_support: up?.neighborSupport ?? null,
                p_axis_deltas: up?.axisDeltas ?? null,
              });


              if (error) {
                toast.error(friendlyError(error, "Couldn't undo."));
                return;
              }
              qc.invalidateQueries({ queryKey: ["ratings"] });
              qc.invalidateQueries({ queryKey: ["canons"] });
              qc.invalidateQueries({ queryKey: ["palate-version"] });
              toast.success("Restored.");
            },
          },
        });
      }
      // Self-healing cuvée re-fingerprint (unchanged).
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
    onError: (err) => {
      // Cancels are silent — everything else surfaces to the caller/toast.
      if (err instanceof RateCanceledError) return;
    },
  });
}

/** Undo counterpart for a cascade demote: restores rating + benchmark atomically. */
export function useRestoreRatingAndBenchmark() {
  const qc = useQueryClient();
  const session = useSession();
  return useMutation({
    mutationFn: async (args: { bottleId: string; stars: number; tier: "canon" | "nemesis" | null }) => {
      const uid = session?.user.id ?? null;
      const p = uid ? await predictForBottleWithFallback(qc, uid, args.bottleId) : null;
      const { data, error } = await (supabase as any).rpc("restore_rating_and_benchmark", {
        p_bottle_id: args.bottleId,
        p_stars: args.stars,
        p_tier: args.tier,
        p_predicted: p?.predicted ?? null,
        p_omega: p?.omega ?? null,
        p_bandwidth: p?.bandwidth ?? null,
        p_n_rated: p?.nRated ?? null,
        p_null_reason: p ? p.nullReason : "fetch_failed",
        p_neighbor_support: p?.neighborSupport ?? null,
        p_axis_deltas: p?.axisDeltas ?? null,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        benchmarkId: (row?.benchmark_id ?? null) as string | null,
        palateVersion: (row?.palate_version ?? null) as number | null,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ratings"] });
      qc.invalidateQueries({ queryKey: ["canons"] });
      qc.invalidateQueries({ queryKey: ["palate-version"] });
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

