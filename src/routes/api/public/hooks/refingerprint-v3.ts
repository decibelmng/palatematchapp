import { createFileRoute } from "@tanstack/react-router";

const JOB_ID = "fcf3b92a-0700-4a85-82a4-7d0d6b5af2a9";
const CRON_JOB_NAME = "refingerprint-v3-main-queue";
const MODEL = "google/gemini-3.6-flash";
const INVOCATION_BUDGET_MS = 55_000;
const MAX_ROWS_PER_INVOCATION = 1500;
const LOCK_TTL_MS = 180_000;

export const Route = createFileRoute("/api/public/hooks/refingerprint-v3")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supplied =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const expected = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "";
        if (!expected || supplied !== expected) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return Response.json({ error: "AI service unavailable" }, { status: 503 });

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const {
            refreshRefingerprintV3Progress,
            getRefingerprintV3PendingCount,
            isRefingerprintV3Paused,
            unscheduleRefingerprintV3Cron,
            runRefingerprintV3Batch,
            acquireRefingerprintV3Lock,
            releaseRefingerprintV3Lock,
            REFINGERPRINT_V3_BATCH_SIZE,
            REFINGERPRINT_V3_CONCURRENCY,
          } = await import("@/lib/refingerprint-v3.server");

          // Two cheap reads instead of nine full-table counts. An empty or paused
          // tick pays for nothing beyond these.
          const [paused, pendingBefore] = await Promise.all([
            isRefingerprintV3Paused(supabaseAdmin, JOB_ID),
            getRefingerprintV3PendingCount(supabaseAdmin),
          ]);
          if (paused || pendingBefore === 0) {
            let unscheduled = false;
            if (!paused && pendingBefore === 0) {
              // Self-terminate rather than firing forever against an empty queue.
              unscheduled = await unscheduleRefingerprintV3Cron(supabaseAdmin, CRON_JOB_NAME);
              await refreshRefingerprintV3Progress(supabaseAdmin, JOB_ID);
            }
            const output = {
              success: true,
              paused,
              complete: pendingBefore === 0,
              unscheduled,
              wrote: 0,
              remaining: pendingBefore,
            };
            console.log("[refingerprint-v3-cron]", JSON.stringify(output));
            return Response.json(output);
          }

          const gotLock = await acquireRefingerprintV3Lock(supabaseAdmin, JOB_ID, LOCK_TTL_MS);
          if (!gotLock) {
            const output = {
              success: true,
              skipped: "another runner holds the lease",
              wrote: 0,
              remaining: pendingBefore,
            };
            console.log("[refingerprint-v3-cron]", JSON.stringify(output));
            return Response.json(output);
          }

          const started = Date.now();
          let wrote = 0;
          let picked = 0;
          let empty = 0;
           let retries = 0;
          const errors: string[] = [];
          try {
            while (
              Date.now() - started < INVOCATION_BUDGET_MS &&
              picked < MAX_ROWS_PER_INVOCATION
            ) {
              const result = await runRefingerprintV3Batch(supabaseAdmin, key, {
                jobId: JOB_ID,
                model: MODEL,
                batchSize: Math.min(REFINGERPRINT_V3_BATCH_SIZE, MAX_ROWS_PER_INVOCATION - picked),
                concurrency: REFINGERPRINT_V3_CONCURRENCY,
              });
              wrote += result.wrote;
              picked += result.picked;
              empty += result.empty;
               retries += result.retries;
              errors.push(...result.errors);
              if (result.picked === 0 || result.remaining === 0 || result.errors.length > 0) break;
            }
          } finally {
            await releaseRefingerprintV3Lock(supabaseAdmin, JOB_ID);
          }
          // One aggregate pass per tick, feeding the monitor's cache.
          const after = await refreshRefingerprintV3Progress(supabaseAdmin, JOB_ID);
          let unscheduled = false;
          if (after.pending === 0) {
            unscheduled = await unscheduleRefingerprintV3Cron(supabaseAdmin, CRON_JOB_NAME);
          }
          const output = {
            success: errors.length === 0,
            picked,
            wrote,
            empty,
             retries,
            remaining: after.pending,
            unscheduled,
            elapsedMs: Date.now() - started,
            errors: errors.slice(0, 10),
          };
          console.log("[refingerprint-v3-cron]", JSON.stringify(output));
          return Response.json(output, { status: errors.length > 0 ? 500 : 200 });

        } catch (error) {
           const message =
             error instanceof Error
               ? `${error.name}: ${error.message || "No error message"}`
               : String(error) || "Unknown error";
           console.error("[refingerprint-v3-cron] failed:", message);
          return Response.json({ success: false, error: message }, { status: 500 });
        }
      },
    },
  },
});