import { createFileRoute } from "@tanstack/react-router";

const JOB_ID = "fcf3b92a-0700-4a85-82a4-7d0d6b5af2a9";
const CRON_JOB_NAME = "refingerprint-v3-main-queue";
const MODEL = "google/gemini-3.6-flash";
const MAX_ROWS_PER_INVOCATION = 1500;

export const Route = createFileRoute("/api/public/hooks/refingerprint-v3")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supplied =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const expected = process.env["SUPABASE_PUBLISHABLE_KEY"] ?? "";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const {
          refreshRefingerprintV3Progress,
          getRefingerprintV3Progress,
          getRefingerprintV3PendingCount,
          isRefingerprintV3Paused,
          unscheduleRefingerprintV3Cron,
          runRefingerprintV3Batch,
          acquireRefingerprintV3Lock,
          releaseRefingerprintV3Lock,
          recordRefingerprintV3Tick,
          REFINGERPRINT_V3_BATCH_SIZE,
          REFINGERPRINT_V3_CONCURRENCY,
          REFINGERPRINT_V3_BUDGET_MS,
          REFINGERPRINT_V3_LOCK_TTL_MS,
        } = await import("@/lib/refingerprint-v3.server");

        // Every exit records its own outcome, so an auth failure or a crash is
        // visible on the monitor instead of looking like a quiet queue.
        const tick = async (
          status: number,
          ok: boolean,
          wrote: number,
          remaining: number | null,
          reason: string | null,
        ) => {
          await recordRefingerprintV3Tick(supabaseAdmin, {
            at: new Date().toISOString(),
            status,
            ok,
            wrote,
            remaining,
            reason,
          });
        };

        if (!expected || supplied !== expected) {
          await tick(401, false, 0, null, "unauthorized — wrong or missing apikey header");
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const key = process.env["LOVABLE_API_KEY"];
        if (!key) {
          await tick(503, false, 0, null, "missing LOVABLE_API_KEY");
          return Response.json({ error: "AI service unavailable" }, { status: 503 });
        }

        try {
          // Two cheap reads instead of nine full-table counts. An empty or paused
          // tick pays for nothing beyond these.
          const [paused, pendingBefore] = await Promise.all([
            isRefingerprintV3Paused(supabaseAdmin, JOB_ID),
            getRefingerprintV3PendingCount(supabaseAdmin, JOB_ID),
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
            await tick(200, true, 0, pendingBefore, paused ? "paused" : "queue empty");
            console.log("[refingerprint-v3-cron]", JSON.stringify(output));
            return Response.json(output);
          }

          const gotLock = await acquireRefingerprintV3Lock(
            supabaseAdmin,
            JOB_ID,
            REFINGERPRINT_V3_LOCK_TTL_MS,
          );
          if (!gotLock) {
            const output = {
              success: true,
              skipped: "another runner holds the lease",
              wrote: 0,
              remaining: pendingBefore,
            };
            await tick(200, true, 0, pendingBefore, "another runner holds the lease");
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
              Date.now() - started < REFINGERPRINT_V3_BUDGET_MS &&
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
          // The cache is maintained incrementally by the batch writer, so a tick
          // never pays for a full-table aggregate.
          const after = await getRefingerprintV3Progress(supabaseAdmin, JOB_ID);
          let unscheduled = false;
          if (after.pending === 0) {
            unscheduled = await unscheduleRefingerprintV3Cron(supabaseAdmin, CRON_JOB_NAME);
          }
          const status = errors.length > 0 ? 500 : 200;
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
          await tick(status, errors.length === 0, wrote, after.pending, errors[0] ?? null);
          console.log("[refingerprint-v3-cron]", JSON.stringify(output));
          return Response.json(output, { status });
        } catch (error) {
          const message =
            error instanceof Error
              ? `${error.name}: ${error.message || "No error message"}`
              : String(error) || "Unknown error";
          console.error("[refingerprint-v3-cron] failed:", message);
          await tick(500, false, 0, null, message);
          return Response.json({ success: false, error: message }, { status: 500 });
        }
      },
    },
  },
});
