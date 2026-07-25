// Admin expert-correction server functions.
//
// Writes go into fp_observations only (append-only). The recompute job
// (admin_fp_recompute_bottle) is the ONLY writer of fp_*/ax_* on bottles.
// Revert = mark observation(s) superseded=true; the recompute job then pulls
// live values back toward prior. History is never deleted.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const FP_AXES = [
  "fresh",
  "acid",
  "tannin",
  "fruit_dark",
  "ripe",
  "oak",
  "body",
  "savory",
] as const;
export type FpAxis = (typeof FP_AXES)[number];

const AXIS_TO_LIVE_COL: Record<FpAxis, string> = {
  fresh: "fp_fresh",
  acid: "fp_acid",
  tannin: "fp_tannin",
  fruit_dark: "fp_fruit_dark",
  ripe: "fp_ripe",
  oak: "fp_oak",
  body: "fp_body",
  savory: "fp_savory",
};
const AXIS_TO_PRIOR_COL: Record<FpAxis, string> = {
  fresh: "fp_fresh_prior",
  acid: "fp_acid_prior",
  tannin: "fp_tannin_prior",
  fruit_dark: "fp_fruit_dark_prior",
  ripe: "fp_ripe_prior",
  oak: "fp_oak_prior",
  body: "fp_body_prior",
  savory: "fp_savory_prior",
};

async function assertAdmin(userId: string) {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || userId !== adminId) throw new Error("Not authorized");
}

const BOTTLE_COLS = [
  "id",
  "name",
  "producer",
  "region",
  "country",
  "grape",
  "vintage",
  "type",
  "fp_prior_precision",
  "refingerprinted_at",
  ...Object.values(AXIS_TO_LIVE_COL),
  ...Object.values(AXIS_TO_PRIOR_COL),
  "ax_body",
  "ax_fruit_char",
  "ax_tannin",
  "ax_acidity",
  "ax_sweet",
].join(",");

export const adminSearchBottlesForCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { q: string }) => {
    const q = (input?.q ?? "").trim();
    if (q.length < 2) throw new Error("Query too short");
    return { q };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const like = `%${data.q}%`;
    const { data: rows, error } = await supabaseAdmin
      .from("bottles")
      .select("id,name,producer,region,vintage,type")
      .or(`name.ilike.${like},producer.ilike.${like}`)
      .limit(25);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const adminGetBottleFingerprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bottleId: string }) => {
    if (!input?.bottleId || typeof input.bottleId !== "string") {
      throw new Error("Missing bottleId");
    }
    return { bottleId: input.bottleId };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: bottle, error } = await supabaseAdmin
      .from("bottles")
      .select(BOTTLE_COLS)
      .eq("id", data.bottleId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!bottle) throw new Error("Bottle not found");

    const { data: obs, error: oErr } = await supabaseAdmin
      .from("fp_observations")
      .select("id,axis,observed_value,precision,source_type,mode,author_id,rationale,superseded,created_at")
      .eq("bottle_id", data.bottleId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (oErr) throw new Error(oErr.message);

    return {
      bottle: bottle as any,
      observations: (obs ?? []) as any[],
      axes: FP_AXES.map((a) => ({
        axis: a,
        priorCol: AXIS_TO_PRIOR_COL[a],
        liveCol: AXIS_TO_LIVE_COL[a],
        prior: (bottle as any)[AXIS_TO_PRIOR_COL[a]] as number,
        live: (bottle as any)[AXIS_TO_LIVE_COL[a]] as number,
      })),
    };
  });

export const adminSubmitCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    bottleId: string;
    rationale: string;
    corrections: { axis: FpAxis; value: number }[];
  }) => {
    if (!input?.bottleId) throw new Error("Missing bottleId");
    const rationale = (input.rationale ?? "").trim();
    if (rationale.length < 3) throw new Error("Rationale is required (min 3 chars)");
    if (!Array.isArray(input.corrections) || input.corrections.length === 0) {
      throw new Error("At least one axis correction is required");
    }
    const clean = input.corrections.map((c) => {
      if (!FP_AXES.includes(c.axis)) throw new Error(`Unknown axis: ${c.axis}`);
      const v = Number(c.value);
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw new Error(`Axis ${c.axis}: value must be 0..1`);
      }
      return { axis: c.axis, value: v };
    });
    return { bottleId: input.bottleId, rationale, corrections: clean };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Snapshot before, for reporting.
    const { data: before, error: bErr } = await supabaseAdmin
      .from("bottles")
      .select(BOTTLE_COLS)
      .eq("id", data.bottleId)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!before) throw new Error("Bottle not found");

    const rows = data.corrections.map((c) => ({
      bottle_id: data.bottleId,
      axis: c.axis,
      observed_value: c.value,
      precision: 8,
      source_type: "expert_admin",
      mode: "live" as const,
      author_id: context.userId,
      rationale: data.rationale,
    }));

    const { data: inserted, error: iErr } = await supabaseAdmin
      .from("fp_observations")
      .insert(rows)
      .select("id,axis,observed_value,precision,created_at");
    if (iErr) throw new Error(iErr.message);

    const { data: moves, error: rErr } = await supabaseAdmin.rpc(
      "admin_fp_recompute_bottle",
      { p_bottle_id: data.bottleId },
    );
    if (rErr) throw new Error(rErr.message);

    return {
      insertedObservationIds: (inserted ?? []).map((r: any) => r.id as string),
      moves: (moves ?? []) as {
        axis: string;
        old_value: number;
        new_value: number;
        sum_lambda: number;
        moved: boolean;
      }[],
      before: before as any,
    };
  });

export const adminRevertObservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { observationId: string }) => {
    if (!input?.observationId) throw new Error("Missing observationId");
    return { observationId: input.observationId };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: obs, error: oErr } = await supabaseAdmin
      .from("fp_observations")
      .select("id,bottle_id,axis,observed_value,superseded")
      .eq("id", data.observationId)
      .maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!obs) throw new Error("Observation not found");
    if (obs.superseded) throw new Error("Already superseded");

    const { error: uErr } = await supabaseAdmin
      .from("fp_observations")
      .update({ superseded: true })
      .eq("id", data.observationId);
    if (uErr) throw new Error(uErr.message);

    const { data: moves, error: rErr } = await supabaseAdmin.rpc(
      "admin_fp_recompute_bottle",
      { p_bottle_id: obs.bottle_id },
    );
    if (rErr) throw new Error(rErr.message);

    return {
      bottleId: obs.bottle_id as string,
      revertedAxis: obs.axis as string,
      moves: (moves ?? []) as {
        axis: string;
        old_value: number;
        new_value: number;
        sum_lambda: number;
        moved: boolean;
      }[],
    };
  });
