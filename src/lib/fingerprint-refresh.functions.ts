import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  refingerprintCuveeByBottleId,
  MAX_FINGERPRINT_ATTEMPTS,
} from "@/lib/fingerprint-worker";

// Self-healing: the first time anyone rates a bottle whose cuvée has never
// been re-scored, that cuvée gets refingerprinted against the calibrated
// anchors. The refingerprinted_at stamp is the natural guard — the shared
// worker no-ops per row once that row is stamped, and stops after 3 attempts
// on the same row, so this cannot be abused into repeated LLM spend.
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
      console.error(
        `[refingerprint] self-heal threw for ${data.bottle_id}: ${e?.message ?? e}`,
      );
      return { skipped: true, reason: e?.message ?? String(e) };
    }
  });

// App-open sweep. A rating fires the self-heal exactly once, so a wine whose
// single attempt failed used to stay unscored forever. On open we retry the
// signed-in user's own rated wines that still have no style reading.
//
// Caps: 3 bottles per session (gateway spend), and the worker's own retry
// ceiling of 3 attempts per row, so a permanently unscoreable wine stops
// costing anything.
export const sweepMyUnscoredBottles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const PER_SESSION = 3;
    try {
      const { data: rated } = await context.supabase
        .from("ratings")
        .select("bottle_id")
        .eq("user_id", context.userId);
      const ids = Array.from(new Set((rated ?? []).map((r) => r.bottle_id)));
      if (ids.length === 0) return { attempted: 0, ok: 0, results: [] as string[] };

      const { supabaseAdmin } = await import(
        "@/integrations/supabase/client.server"
      );
      const { data: pending } = await supabaseAdmin
        .from("bottles")
        .select("id,fingerprint_attempts")
        .in("id", ids)
        .is("refingerprinted_at", null)
        .lt("fingerprint_attempts", MAX_FINGERPRINT_ATTEMPTS)
        .order("fingerprint_attempts", { ascending: true })
        .limit(PER_SESSION);

      const results: string[] = [];
      let ok = 0;
      for (const row of pending ?? []) {
        try {
          const r = await refingerprintCuveeByBottleId(row.id, supabaseAdmin);
          if ("ok" in r) { ok++; results.push(`${row.id}: ok`); }
          else results.push(`${row.id}: ${r.reason}`);
        } catch (e: any) {
          console.error(`[refingerprint] sweep threw for ${row.id}: ${e?.message ?? e}`);
          results.push(`${row.id}: ${e?.message ?? String(e)}`);
        }
      }
      const attempted = (pending ?? []).length;
      // A sweep that attempts rows and scores none is a broken write path, not
      // a quiet session. Say so.
      if (attempted > ok) {
        console.error(
          `[refingerprint] sweep scored ${ok} of ${attempted}: ${results.join(" | ")}`,
        );
      }
      return { attempted, ok, results };
    } catch (e: any) {
      console.error(`[refingerprint] sweep failed: ${e?.message ?? e}`);
      return { attempted: 0, ok: 0, results: [e?.message ?? String(e)] };
    }
  });
