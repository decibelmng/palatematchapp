import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { aggregateRated } from "@/lib/cuvee";
import type { WineType, FpKey, RatedFp } from "@/lib/recommender";

// Same column set the client uses (BOTTLE_COLS in use-palate-data.ts).
const BOTTLE_COLS =
  "id,name,producer,region,grape,vintage,type,critic_score,price_band,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet,tasting_note,source,added_by";

const LOVE_THRESHOLD = 4;
const PER_LOVED = 40;
const PER_TYPE_CRITIC = 150;
const OVERALL_CAP = 800;

const WINE_TYPES: readonly WineType[] = ["red", "white", "sparkling", "rose", "dessert"];

function toWineType(t: string | null): WineType {
  const s = (t ?? "red").toLowerCase();
  return (WINE_TYPES as readonly string[]).includes(s) ? (s as WineType) : "red";
}

/**
 * Personalized candidate pool for /pour and the home "Top matches" section.
 *
 * Strategy (server-side, RLS-scoped):
 *   1. Load the caller's ratings.
 *   2. Load the rated bottles (type + fingerprint).
 *   3. aggregateRated → cuvées; keep those with avg stars ≥ 4 (loved).
 *   4. Call rpc_pour_candidates:
 *        - for each loved cuvée, the 40 closest bottles of the same type by
 *          squared fingerprint distance across the 8 fp_* columns;
 *        - the top 150 bottles per rated type by critic_score.
 *        Dedup + exclude the caller's rated bottle ids. Cap 800.
 */
export const getPourCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // 1. Ratings.
    const { data: ratings, error: rErr } = await supabase
      .from("ratings")
      .select("bottle_id,stars")
      .eq("user_id", userId);
    if (rErr) throw new Error(rErr.message);

    const ratedIds = (ratings ?? []).map((r) => r.bottle_id as string);
    const starsById = new Map<string, number>();
    for (const r of ratings ?? []) starsById.set(r.bottle_id as string, r.stars as number);

    // No ratings yet → return top critic scorers across all types.
    if (ratedIds.length === 0) {
      const { data, error } = await supabase.rpc("rpc_pour_candidates", {
        loved: [],
        rated_types: WINE_TYPES as unknown as string[],
        excluded_ids: [],
        per_loved: PER_LOVED,
        per_type_critic: PER_TYPE_CRITIC,
        overall_cap: OVERALL_CAP,
      });
      if (error) throw new Error(error.message);
      return { bottles: (data ?? []) as any[] };
    }

    // 2. Rated bottles (needed for cuvée aggregation).
    const ratedBottles: any[] = [];
    for (let i = 0; i < ratedIds.length; i += 200) {
      const chunk = ratedIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from("bottles")
        .select(
          "id,name,producer,region,type,vintage,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory",
        )
        .in("id", chunk);
      if (error) throw new Error(error.message);
      ratedBottles.push(...(data ?? []));
    }

    // 3. Cuvée aggregation → loved subset.
    const ratedRows: (RatedFp & { vintage: number | null })[] = ratedBottles.map((b) => ({
      id: b.id,
      name: b.name,
      producer: b.producer,
      region: b.region,
      type: toWineType(b.type),
      vintage: b.vintage ?? null,
      fp: {
        fresh: b.fp_fresh, acid: b.fp_acid, tannin: b.fp_tannin, fruit_dark: b.fp_fruit_dark,
        ripe: b.fp_ripe, oak: b.fp_oak, body: b.fp_body, savory: b.fp_savory,
      } as Record<FpKey, number>,
      stars: starsById.get(b.id) ?? 0,
    }));

    const cuvees = aggregateRated(ratedRows);
    const loved = cuvees.filter((c) => c.stars >= LOVE_THRESHOLD);

    const lovedPayload = loved.map((c) => ({
      type: c.type,
      fresh: c.fp.fresh, acid: c.fp.acid, tannin: c.fp.tannin, fruit_dark: c.fp.fruit_dark,
      ripe: c.fp.ripe, oak: c.fp.oak, body: c.fp.body, savory: c.fp.savory,
    }));

    // Rated types (deduped) — feeds the per-type critic slice.
    const ratedTypes = Array.from(new Set(cuvees.map((c) => c.type)));

    // 4. Server-side candidate selection.
    const { data, error } = await supabase.rpc("rpc_pour_candidates", {
      loved: lovedPayload,
      rated_types: ratedTypes,
      excluded_ids: ratedIds,
      per_loved: PER_LOVED,
      per_type_critic: PER_TYPE_CRITIC,
      overall_cap: OVERALL_CAP,
    });
    if (error) throw new Error(error.message);

    // Project to BOTTLE_COLS shape (RPC returns full row; the client only needs these).
    const cols = BOTTLE_COLS.split(",");
    const bottles = ((data ?? []) as any[]).map((row) => {
      const out: Record<string, any> = {};
      for (const k of cols) out[k] = row[k];
      return out;
    });

    return { bottles };
  });
