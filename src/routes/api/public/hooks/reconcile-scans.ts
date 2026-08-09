// Scheduled scan reconciliation.
//
// The client used to be the only actor that could move a scan out of
// "processing". This endpoint removes that dependency: pg_cron calls it, it
// finds scans whose batches all landed but were never finalized, and it runs the
// same finalize core the app runs. Public prefix (bypasses site auth), so the
// handler authenticates the caller itself.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/reconcile-scans")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const expected = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "";
        if (!expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Sweeps across users, so it needs to read and write rows it does not
        // own — the one legitimate service-role use in this path.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { reconcileStuckScans } = await import("@/lib/scan-finalize.server");
        try {
          const out = await reconcileStuckScans(supabaseAdmin as any, {
            olderThanMinutes: 10,
            limit: 25,
          });
          console.log("[reconcile-scans]", JSON.stringify(out));
          return new Response(JSON.stringify({ success: true, ...out }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("[reconcile-scans] failed:", (e as Error).message);
          return new Response(JSON.stringify({ success: false, error: (e as Error).message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
