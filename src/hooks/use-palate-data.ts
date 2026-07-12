import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "./use-session";
import type { PaletteType } from "@/lib/palate";
import { recommend, type BottleFp, type FpKey, type RatedFp, type WineType } from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";
import { refreshBottleFingerprint } from "@/lib/fingerprint-refresh.functions";
import { usePalateVersion } from "./use-palate-version";
import { confirmDialog } from "@/components/confirm-dialog";
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
  added_by: string | null;
  price_band: string | null;
  raw?: boolean;                    // true = no calibrated fingerprint (LLM/harmonized/refingerprinted all absent)
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

/** True when the bottle has calibrated fingerprint axes (not defaults). */
export function isCalibrated(b: BottleRow | null | undefined): boolean {
  if (!b) return false;
  if ((b as { raw?: boolean }).raw) return false;
  // Server gate is `fp_fresh IS NOT NULL`; client BottleRow types it as number,
  // so we conservatively treat 0-vector as uncalibrated too.
  const fp = bottleToFp(b);
  return Object.values(fp).some((v) => Number.isFinite(v) && v !== 0);
}

/** Compute predicted stars for a candidate bottle from cached ratings + bottle rows.
 *  Returns null when there's not enough context or the bottle isn't calibrated —
 *  the dispute signal only fires against a real prediction. */
export function predictForBottleFromCache(
  qc: QueryClient,
  userId: string,
  target: BottleRow,
): number | null {
  if (!isCalibrated(target)) return null;
  const ratings = qc
    .getQueriesData<{ bottle_id: string; stars: number }[]>({ queryKey: ["ratings", userId] })
    .flatMap(([, data]) => data ?? []);
  if (ratings.length < 3) return null;

  // Collect rated bottles from any cached bottles queries.
  const allBottles = qc
    .getQueriesData<BottleRow[]>({ queryKey: ["bottles"] })
    .flatMap(([, data]) => data ?? []);
  const bottleById = new Map<string, BottleRow>();
  for (const b of allBottles) if (b?.id) bottleById.set(b.id, b);

  const targetType = bottleType(target);
  const sameType: RatedFp[] = [];
  const rawSameType: (RatedFp & { vintage: number | null })[] = [];
  for (const r of ratings) {
    const b = bottleById.get(r.bottle_id);
    if (!b) continue;
    if (bottleType(b) !== targetType) continue;
    if (!isCalibrated(b)) continue;
    rawSameType.push({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage, fp: bottleToFp(b), stars: r.stars,
    });
  }
  if (rawSameType.length === 0) return null;
  const cuvees = aggregateRated(rawSameType);
  for (const c of cuvees) {
    sameType.push({
      id: c.id, name: c.name, producer: c.producer, region: c.region,
      type: c.type, fp: c.fp, stars: c.stars,
    });
  }
  const cand: BottleFp = {
    id: target.id, name: target.name, producer: target.producer, region: target.region,
    type: targetType, fp: bottleToFp(target),
  };
  const [rec] = recommend(sameType, [cand]);
  return rec?.predicted ?? null;
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
        .select("bottle_id,stars")
        .eq("user_id", session!.user.id);
      if (error) throw error;
      return data ?? [];
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
};

type RateResult = {
  bottleId: string;
  stars: number | null;
  demotedTier: "canon" | "nemesis" | null;
  previousStars: number | null;
  palateVersion: number | null;
};

export function useRate() {
  const session = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bottleId, stars, onCascadeConfirm }: RateInput): Promise<RateResult> => {
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
            ? `This is your Canon (${region}) — lowering the rating removes Canon status.`
            : `This is your Nemesis (${region}) — raising the rating removes Nemesis status.`;
          return confirmDialog({
            title: tier === "canon" ? "Remove Canon status?" : "Remove Nemesis status?",
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

      // Predict against pre-rating palate state — this is the dispute signal.
      // null when the target bottle isn't calibrated or we lack context.
      const targetBottle = qc
        .getQueriesData<BottleRow[]>({ queryKey: ["bottles"] })
        .flatMap(([, data]) => data ?? [])
        .find((b): b is BottleRow => !!b && b.id === bottleId) ?? null;
      const predicted = targetBottle
        ? predictForBottleFromCache(qc, session.user.id, targetBottle)
        : null;

      const { data, error } = await (supabase as any).rpc("save_rating_with_cascade", {
        p_bottle_id: bottleId,
        p_stars: stars,
        p_predicted: predicted,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return {
        bottleId,
        stars,
        demotedTier: (row?.demoted_tier ?? null) as "canon" | "nemesis" | null,
        previousStars: (row?.previous_stars ?? null) as number | null,
        palateVersion: (row?.palate_version ?? null) as number | null,
      };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["ratings"] });
      qc.invalidateQueries({ queryKey: ["palate-version"] });
      if (result?.demotedTier) {
        qc.invalidateQueries({ queryKey: ["canons"] });
        // 10s undo — restores rating + benchmark in one atomic RPC (+1 version bump).
        const verb = result.demotedTier === "canon" ? "Canon" : "Nemesis";
        toast(`${verb} removed (rating changed).`, {
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: async () => {
              if (result.previousStars == null) {
                toast.error("No previous rating to restore.");
                return;
              }
              const undoTarget = qc
                .getQueriesData<BottleRow[]>({ queryKey: ["bottles"] })
                .flatMap(([, data]) => data ?? [])
                .find((b): b is BottleRow => !!b && b.id === result.bottleId) ?? null;
              const undoPredicted = undoTarget && session
                ? predictForBottleFromCache(qc, session.user.id, undoTarget)
                : null;
              const { error } = await (supabase as any).rpc("restore_rating_and_benchmark", {
                p_bottle_id: result.bottleId,
                p_stars: result.previousStars,
                p_tier: result.demotedTier,
                p_predicted: undoPredicted,
              });

              if (error) {
                toast.error(error.message || "Couldn't undo.");
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
  return useMutation({
    mutationFn: async (args: { bottleId: string; stars: number; tier: "canon" | "nemesis" | null }) => {
      const { data, error } = await (supabase as any).rpc("restore_rating_and_benchmark", {
        p_bottle_id: args.bottleId,
        p_stars: args.stars,
        p_tier: args.tier,
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

