/** Server-side prediction — the fallback for the null path.
 *
 *  The client can only predict from bottles it happens to have cached. When a
 *  rating comes in from a screen that never loaded the user's rated bottles,
 *  the prediction was silently null and the outcome was unmeasurable. That
 *  biases the log toward exactly the ratings we can already explain, so the
 *  fallback fetches the real rated set and computes the same number.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { predictStars, predictStarsMany, type FpRow, type PredictResult } from "@/lib/predict-core";

const FP_COLS =
  "id,name,producer,region,vintage,type,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory";

type Client = { from: (t: string) => any };

/** Load the caller's rated bottles with fingerprints. RLS-scoped. */
export async function loadRatedFpRows(
  supabase: Client,
  userId: string,
): Promise<{ bottle: FpRow; stars: number }[]> {
  const { data: ratings } = await supabase
    .from("ratings")
    .select("bottle_id,stars")
    .eq("user_id", userId);
  const rows = (ratings ?? []) as { bottle_id: string; stars: number }[];
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => r.bottle_id))];
  const bottles: FpRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("bottles")
      .select(FP_COLS)
      .in("id", ids.slice(i, i + 200));
    bottles.push(...((data ?? []) as FpRow[]));
  }
  const byId = new Map(bottles.map((b) => [b.id, b]));
  return rows
    .map((r) => ({ bottle: byId.get(r.bottle_id) as FpRow, stars: r.stars }))
    .filter((r) => !!r.bottle);
}

/** Core, callable from other server code (e.g. scan finalize). */
export async function predictForBottleCore(
  supabase: Client,
  userId: string,
  bottleId: string,
): Promise<PredictResult> {
  const { data: target } = await supabase
    .from("bottles").select(FP_COLS).eq("id", bottleId).maybeSingle();
  if (!target) {
    return { predicted: null, omega: null, bandwidth: null, nRated: 0, nullReason: "fetch_failed" };
  }
  const rated = await loadRatedFpRows(supabase, userId);
  return predictStars(rated, target as FpRow);
}

export async function predictForBottlesCore(
  supabase: Client,
  userId: string,
  bottleIds: string[],
): Promise<Map<string, PredictResult>> {
  const ids = [...new Set(bottleIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const targets: FpRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from("bottles").select(FP_COLS).in("id", ids.slice(i, i + 200));
    targets.push(...((data ?? []) as FpRow[]));
  }
  const rated = await loadRatedFpRows(supabase, userId);
  return predictStarsMany(rated, targets);
}

export const predictStarsForBottle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ bottle_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PredictResult> => {
    const { supabase, userId } = context;
    return predictForBottleCore(supabase as unknown as Client, userId, data.bottle_id);
  });
