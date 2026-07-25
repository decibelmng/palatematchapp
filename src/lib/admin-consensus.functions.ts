// Phase 4 — Consensus correction engine (shadow only).
//
// All logic lives in Postgres (admin_consensus_gate_status / _scan / _validate
// and admin_fp_drift). These server functions are the thin admin surface — they
// gate on the admin user id and forward to the SQL routines. Shadow observations
// (mode='shadow') are invisible to the live recompute job, so nothing here can
// corrupt live fp_* values by design.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || userId !== adminId) throw new Error("Not authorized");
}

export const adminConsensusStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [gate, drift] = await Promise.all([
      supabaseAdmin.rpc("admin_consensus_gate_status"),
      supabaseAdmin.rpc("admin_fp_drift"),
    ]);
    if (gate.error) throw new Error(gate.error.message);
    if (drift.error) throw new Error(drift.error.message);
    return {
      gate: (gate.data?.[0] ?? null) as {
        total_ratings: number;
        distinct_users: number;
        min_ratings: number;
        min_users: number;
        global_pass: boolean;
      } | null,
      drift: (drift.data?.[0] ?? null) as {
        n_bottles: number;
        drift_sum: number;
        drift_max: number;
        drift_p95: number;
        n_moved: number;
      } | null,
    };
  });

export const adminConsensusScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { write?: boolean }) => ({
    write: !!input?.write,
  }))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("admin_consensus_scan", {
      p_write: data.write,
    });
    if (error) throw new Error(error.message);
    const summary = (rows?.[0] ?? null) as {
      run_id: string;
      bottles_eligible: number;
      axes_evaluated: number;
      observations_written: number;
      global_pass: boolean;
    } | null;

    let candidates: any[] = [];
    if (summary?.run_id) {
      const { data: cRows, error: cErr } = await supabaseAdmin
        .from("fp_consensus_candidates")
        .select(
          "id,bottle_id,axis,n_raters,n_palate_codes,mean_residual,sign_consistency,prior_value,proposed_value,eligible,reason,written_observation_id",
        )
        .eq("run_id", summary.run_id)
        .order("eligible", { ascending: false })
        .limit(500);
      if (cErr) throw new Error(cErr.message);
      candidates = cRows ?? [];
    }
    return { summary, candidates };
  });

export const adminConsensusValidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { observationId: string }) => {
    if (!input?.observationId) throw new Error("Missing observationId");
    return { observationId: input.observationId };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("admin_consensus_validate", {
      p_observation_id: data.observationId,
    });
    if (error) throw new Error(error.message);
    return (rows?.[0] ?? null) as {
      observation_id: string;
      bottle_id: string | null;
      axis: string | null;
      n_test: number;
      err_prior: number;
      err_shadow: number;
      promoted: boolean;
      reason: string;
    } | null;
  });

export const adminConsensusListShadow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("fp_observations")
      .select("id,bottle_id,axis,observed_value,precision,mode,superseded,rationale,created_at")
      .eq("source_type", "consensus_miss")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
