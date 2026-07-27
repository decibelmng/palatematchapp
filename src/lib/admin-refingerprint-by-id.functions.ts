// One-shot targeted re-fingerprint by bottle id, gated to ADMIN_USER_ID.
// Runs the SAME LLM pipeline (callFingerprintGateway via
// refingerprintCuveeByBottleId) as the base catalog — no hand-rolled math.
//
// Used to backfill the three legacy `user-added` whites whose ax_fruit_char
// was written by a retired code path (Gaja Rossj-Bass, La Spinetta Derthona,
// Ballot-Millot Meursault). The `bottles_enforce_ax_mapping_trg` trigger
// installed alongside this file keeps ax_* in lockstep with fp_* on every
// write, so the mapping bug can't recur.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { refingerprintCuveeByBottleId } from "@/lib/fingerprint-worker";

const Input = z.object({
  bottle_id: z.string().uuid(),
  /** Force a re-fingerprint even if the cuvée group is already stamped. */
  force: z.boolean().optional(),
});

export const adminRefingerprintById = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }) => {
    const adminId = process.env.ADMIN_USER_ID;
    if (!adminId || context.userId !== adminId) {
      throw new Error("Not authorized");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.force) {
      // Clear the stamp so the worker's "already refingerprinted" guard
      // doesn't short-circuit. `bottles_seed_prior` only writes priors on
      // INSERT, so this UPDATE won't disturb them.
      await supabaseAdmin
        .from("bottles")
        .update({ refingerprinted_at: null })
        .eq("id", data.bottle_id);
    }

    const res = await refingerprintCuveeByBottleId(data.bottle_id, supabaseAdmin);
    return res;
  });
