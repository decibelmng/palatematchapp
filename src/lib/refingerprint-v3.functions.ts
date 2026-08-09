// Full-catalog v3 re-fingerprint — SHADOW COLUMNS ONLY.
//
// Nothing here writes fp_fresh…fp_savory. Every reading lands in fp_*_v3 plus
// fp_v3_scored_at / fp_v3_job_id / fp_v3_axes_read, so the live engine keeps
// serving v1 untouched until the atomic swap. Mixed calibration is worse than
// uniformly wrong calibration — distances between a corrected wine and an
// uncorrected one become artifacts of which batch each landed in — so the swap
// is one transaction, never a rolling migration.
//
// RESUMABILITY. There is no cursor and no claim table. "Pending" is a fact in
// the row: fp_v3_scored_at IS NULL and a recovered tasting note exists
// (bottles_fp_v3_pending_idx). An interrupted batch leaves its unwritten rows
// pending, so the next call picks them up; a written row is never revisited.
// Killing the tab mid-run costs at most one batch of gateway calls.
//
// A note the scorer cannot read is stamped with axes_read = 0 and all axes null
// rather than left pending — otherwise one unparseable row blocks the queue
// forever. Zero axes read is an honest record, and the thin-note rule already
// keeps such a wine out of the Call.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  scoreFromNoteV3,
  FINGERPRINT_PIPELINE_V3,
  FINGERPRINT_PIPELINE_V3_AMBIGUOUS,

  V3_AXES,
} from "@/lib/fingerprint-prompt-v3";

/** Rows per server call. Sized so a batch finishes well inside the edge
 *  request window even when a few calls retry. */
const BATCH_SIZE = 24;
/** Gateway calls in flight. Above ~8 the gateway starts returning 429s, which
 *  cost a retry each and make the run slower, not faster. */
const CONCURRENCY = 6;

const Input = z
  .object({
    jobId: z.string().uuid(),
    model: z.string().min(3),
    batchSize: z.number().int().min(1).max(60).optional(),
    concurrency: z.number().int().min(1).max(10).optional(),
  });

async function admin(context: { userId: string }) {
  const adminId = process.env["ADMIN_USER_ID"];
  if (!adminId || context.userId !== adminId) throw new Error("Not authorized");
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("Missing LOVABLE_API_KEY");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { key, supabaseAdmin };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export const refingerprintV3Progress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await admin(context);
    const count = async (build: (q: any) => any) => {
      const { count: c, error } = await build(
        supabaseAdmin.from("bottles").select("id", { count: "exact", head: true }),
      );
      if (error) throw new Error(error.message);
      return c ?? 0;
    };
    // Pending = any bottle with a recovered review and no shadow reading yet.
    // Ambiguous joins are IN scope: excluding them would leave ~10k rows on the
    // v1 typicity grid after the swap, which is exactly the mixed calibration
    // this pipeline exists to remove. They are scored, stamped
    // note_v3_ambiguous_join, and kept out of the Call alongside thin reads.
    const pendingWithNote = async () => {
      const { count: c, error } = await supabaseAdmin
        .from("bottles")
        .select("id,catalog_source_notes!inner(bottle_id)", { count: "exact", head: true })
        .is("fp_v3_scored_at", null);
      if (error) throw new Error(error.message);
      return c ?? 0;
    };
    const [scored, pending, thin, empty, ambiguous] = await Promise.all([
      count((q: any) => q.not("fp_v3_scored_at", "is", null)),
      pendingWithNote(),
      count((q: any) => q.not("fp_v3_scored_at", "is", null).lte("fp_v3_axes_read", 3)),
      count((q: any) => q.not("fp_v3_scored_at", "is", null).eq("fp_v3_axes_read", 0)),
      count((q: any) => q.eq("fp_v3_pipeline", FINGERPRINT_PIPELINE_V3_AMBIGUOUS)),
    ]);
    return { scored, pending, thin, empty, ambiguous };

  });

export const refingerprintV3Batch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ context, data }) => {
    const { key, supabaseAdmin } = await admin(context);
    const size = data.batchSize ?? BATCH_SIZE;
    const lanes = data.concurrency ?? CONCURRENCY;

    // Pending slice off bottles_fp_v3_pending_idx. Ordered by id so the read is
    // deterministic and two overlapping drivers converge instead of thrashing.
    //
    // The note is the recovered human review in catalog_source_notes, joined on
    // bottle_id — NOT bottles.tasting_note, which carries a note for only 116
    // rows. An ambiguous join (one review that could belong to any of several
    // sibling bottles) is IN SCOPE and stamped note_v3_ambiguous_join. Leaving
    // it out would keep ~10k rows on the v1 typicity grid after the swap — the
    // mixed calibration we rejected — and it turns a guess into a measurement:
    // their within-group SD can be compared against the clean set afterward.
    // Until that check clears, the flag keeps them out of the Call.
    const { data: rows, error: readErr } = await supabaseAdmin
      .from("bottles")
      .select("id,type,catalog_source_notes!inner(note,ambiguous)")
      .is("fp_v3_scored_at", null)
      .order("id", { ascending: true })
      .limit(size);
    if (readErr) throw new Error(readErr.message);

    const firstNote = (r: any) =>
      Array.isArray(r.catalog_source_notes) ? r.catalog_source_notes[0] : r.catalog_source_notes;
    const batch = (rows ?? [])
      .map((r: any) => {
        const n = firstNote(r) ?? {};
        return {
          id: r.id as string,
          type: r.type as string,
          note: String(n.note ?? ""),
          ambiguous: Boolean(n.ambiguous),
        };
      })
      .filter((r) => r.note.trim().length >= 20);
    const errors: string[] = [];
    let wrote = 0;
    let empty = 0;
    let ambiguousWrote = 0;


    await mapLimit(batch, lanes, async (row) => {
      let fp: Record<string, number | null> | null = null;
      let sweet: number | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await scoreFromNoteV3(row.type, row.note, key, data.model);
          fp = res.fp as any;
          sweet = res.ax_sweet;
          break;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (attempt === 2) errors.push(`${row.id}: ${msg}`);
          else await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }

      // Unreadable after retries → record a zero-axis read so the queue drains.
      const values = fp ?? Object.fromEntries(V3_AXES.map((a) => [a, null]));
      const axesReadCount = V3_AXES.reduce(
        (n, a) => (typeof values[a] === "number" ? n + 1 : n),
        0,
      );
      if (fp == null) empty++;

      const patch: Record<string, string | number | null> = {
        fp_v3_scored_at: new Date().toISOString(),
        fp_v3_job_id: data.jobId,
        fp_v3_axes_read: axesReadCount,
        fp_v3_pipeline: row.ambiguous
          ? FINGERPRINT_PIPELINE_V3_AMBIGUOUS
          : FINGERPRINT_PIPELINE_V3,
      };
      for (const a of V3_AXES) patch[`fp_${a}_v3`] = values[a];
      // ax_sweet is independent of the eight style axes and is not generated,
      // so it has no shadow column; it is left alone by the shadow run.
      void sweet;

      const { error: wErr } = await supabaseAdmin.from("bottles").update(patch as never).eq("id", row.id);
      if (wErr) errors.push(`${row.id} write: ${wErr.message}`);
      else {
        wrote++;
        if (row.ambiguous) ambiguousWrote++;
      }
    });

    const { count: remaining } = await supabaseAdmin
      .from("bottles")
      .select("id,catalog_source_notes!inner(bottle_id)", { count: "exact", head: true })
      .is("fp_v3_scored_at", null);

    return {
      pipeline: FINGERPRINT_PIPELINE_V3,
      model: data.model,
      picked: batch.length,
      wrote,
      ambiguousWrote,
      empty,
      remaining: remaining ?? 0,
      errors: errors.slice(0, 10),
    };
  });

