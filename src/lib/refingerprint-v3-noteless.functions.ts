// The note-less tail of the v3 re-fingerprint — SHADOW COLUMNS ONLY.
//
// The main queue joins catalog_source_notes!inner, so 116 rows can never be
// picked up by it: 98 on-demand resolves, 15 blinded_v2 rows and 3 v1 bulk rows
// with no recovered review. Fourteen of them are wines the owner has rated.
//
// Why they are a swap blocker, not a follow-up: after the swap the catalog is
// pure v3 and the rated set would be a v2/v3 mix. Training on one calibration
// and ranking against another is the same cross-calibration failure the swap
// exists to remove, with the populations swapped.
//
// Method, and it is second-class on purpose: score the note the row already
// carries (110 of 116 do — written by the v2 on-demand gateway at insert), or
// generate one from producer/region/grape/vintage when it has none, then score
// it with the SAME de-anchored v3 scorer, blind. Every such reading is stamped
// note_v3_generated so a future audit can separate it from the note-derived
// population — which it measurably differs from.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  scoreNotelessV3,
  FINGERPRINT_PIPELINE_V3_GENERATED,
  V3_AXES,
} from "@/lib/fingerprint-prompt-v3";

const Input = z.object({
  jobId: z.string().uuid(),
  model: z.string().min(3),
  batchSize: z.number().int().min(1).max(60).optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
});

async function admin(context: { userId: string }) {
  const adminId = process.env["ADMIN_USER_ID"];
  if (!adminId || context.userId !== adminId) throw new Error("Not authorized");
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { key, supabaseAdmin };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        await fn(items[i]);
      }
    }),
  );
}

/**
 * Rows with no recovered review and no shadow reading.
 *
 * This used to read the 4,000 oldest pending ids, then ask
 * catalog_source_notes which of them HAD a review in chunks of 500 and subtract
 * the two sets client-side. That threw `TypeError: fetch failed` — a transport
 * failure, not a PostgREST error, which is why it surfaced as a blank screen
 * instead of a message: 500 uuids in an `in.()` filter is a ~19 KB query string,
 * and the request is rejected at the URL-length limit before any handler runs.
 * The main queue never hit it because it asks the database for the join
 * (`catalog_source_notes!inner`) and ships one short URL per batch.
 *
 * So do the same thing here, inverted: a LEFT embed with `is.null` on it is an
 * anti-join evaluated server-side. One request, constant URL length.
 */
async function pickNoteless(supabaseAdmin: any, limit: number) {
  const { data, error } = await supabaseAdmin
    .from("bottles")
    .select(
      "id,producer,name,type,region,country,grape,vintage,tasting_note,catalog_source_notes!left(bottle_id)",
    )
    .is("fp_v3_scored_at", null)
    .is("catalog_source_notes", null)
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const refingerprintV3NotelessProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await admin(context);
    const pending = await pickNoteless(supabaseAdmin, 4000);
    const { count: done } = await supabaseAdmin
      .from("bottles")
      .select("id", { count: "exact", head: true })
      .eq("fp_v3_pipeline", FINGERPRINT_PIPELINE_V3_GENERATED);
    return { pending: pending.length, done: done ?? 0 };
  });

export const refingerprintV3NotelessBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ context, data }) => {
    const { key, supabaseAdmin } = await admin(context);
    const batch = await pickNoteless(supabaseAdmin, data.batchSize ?? 40);
    const errors: string[] = [];
    let wrote = 0;
    let generated = 0;

    await mapLimit(batch, data.concurrency ?? 8, async (row: any) => {
      let res: Awaited<ReturnType<typeof scoreNotelessV3>> | null = null;
      const hadNote = (row.tasting_note ?? "").trim().length >= 40;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          res = await scoreNotelessV3(
            {
              producer: row.producer, name: row.name, type: row.type,
              region: row.region, country: row.country,
              grape: row.grape, vintage: row.vintage,
            },
            key,
            data.model,
            row.tasting_note,
          );
          break;
        } catch (e: any) {
          if (attempt === 2) errors.push(`${row.id}: ${e?.message ?? String(e)}`);
          else await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      if (!res) return; // leave pending — this tail is small enough to retry
      if (!hadNote) generated++;

      const patch: Record<string, string | number | null> = {
        fp_v3_scored_at: new Date().toISOString(),
        fp_v3_job_id: data.jobId,
        fp_v3_axes_read: V3_AXES.reduce(
          (n, a) => (typeof res!.fp[a] === "number" ? n + 1 : n),
          0,
        ),
        fp_v3_pipeline: FINGERPRINT_PIPELINE_V3_GENERATED,
      };
      for (const a of V3_AXES) patch[`fp_${a}_v3`] = res.fp[a];
      // The generated note is derived data and carries its derivation: it is
      // stored so the reading can be re-audited, but only when the row had none.
      if (!hadNote) patch["tasting_note"] = res.note;

      const { error } = await supabaseAdmin.from("bottles").update(patch as never).eq("id", row.id);
      if (error) errors.push(`${row.id} write: ${error.message}`);
      else wrote++;
    });

    return {
      pipeline: FINGERPRINT_PIPELINE_V3_GENERATED,
      picked: batch.length,
      wrote,
      notesGenerated: generated,
      errors: errors.slice(0, 10),
    };
  });
