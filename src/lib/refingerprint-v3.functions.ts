import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getRefingerprintV3Progress,
  refreshRefingerprintV3Progress,
  runRefingerprintV3Batch,
  setRefingerprintV3Paused,
} from "@/lib/refingerprint-v3.server";

type AdminContext = { userId: string };

export const refingerprintV3Progress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const adminId = process.env["ADMIN_USER_ID"];
    if (!adminId || context.userId !== adminId) throw new Error("Not authorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return getRefingerprintV3Progress(
      supabaseAdmin,
      "fcf3b92a-0700-4a85-82a4-7d0d6b5af2a9",
    );
  });

export const refingerprintV3Batch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      jobId: z.string().uuid(),
      model: z.string().min(3),
      batchSize: z.number().int().min(1).max(60).optional(),
      concurrency: z.number().int().min(1).max(24).optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const adminId = process.env["ADMIN_USER_ID"];
    if (!adminId || context.userId !== adminId) throw new Error("Not authorized");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runRefingerprintV3Batch(supabaseAdmin, key, data);
  });

export const refingerprintV3SetPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ jobId: z.string().uuid(), paused: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const adminId = process.env["ADMIN_USER_ID"];
    if (!adminId || context.userId !== adminId) throw new Error("Not authorized");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await setRefingerprintV3Paused(supabaseAdmin, data.jobId, data.paused);
    // One aggregate pass on a manual tap so the monitor reflects the change now
    // instead of waiting for the next scheduled tick.
    await refreshRefingerprintV3Progress(supabaseAdmin, data.jobId);
    return result;
  });