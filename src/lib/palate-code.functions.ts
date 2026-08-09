// Thin wrapper: server-fn declarations only (tss-serverfn-split safety).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Recompute the caller's palate codes from their ratings and persist them.
 * Called right after any rating write — the same event that bumps
 * palate_version — so the code can never lag the version it is derived from.
 */
export const recomputePalateCodesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { recomputeAndStoreCodes } = await import("@/lib/palate-code.server");
    return recomputeAndStoreCodes(context.supabase, context.userId);
  });
