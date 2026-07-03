import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { refingerprintCuveeByBottleId } from "@/lib/fingerprint-worker";

// Self-healing: the first time anyone rates a bottle whose cuvée has never
// been re-scored, that cuvée gets refingerprinted against the calibrated
// anchors. The refingerprinted_at stamp is the natural guard — the shared
// worker no-ops if any row in the group is already stamped, so this cannot
// be abused into repeated LLM spend.
//
// Any authenticated user may call this. Never throws to the client for
// gateway failures — always returns { skipped, reason } so the rating flow
// is never broken.
export const refreshBottleFingerprint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bottle_id: string }) => data)
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const result = await refingerprintCuveeByBottleId(
        data.bottle_id,
        supabaseAdmin,
      );
      if ("ok" in result) {
        return { ok: true, groupSize: result.groupSize };
      }
      return { skipped: true, reason: result.reason };
    } catch (e: any) {
      return { skipped: true, reason: e?.message ?? String(e) };
    }
  });
