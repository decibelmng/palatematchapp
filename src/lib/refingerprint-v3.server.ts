import {
  FINGERPRINT_PIPELINE_V3,
  FINGERPRINT_PIPELINE_V3_AMBIGUOUS,
  V3_AXES,
  scoreFromNoteV3,
} from "@/lib/fingerprint-prompt-v3";

export const REFINGERPRINT_V3_BATCH_SIZE = 125;
export const REFINGERPRINT_V3_CONCURRENCY = 64;
export const REFINGERPRINT_V3_PAUSE_MARKER = "[v3 cron paused]";
const LOCK_PREFIX = "[v3 lock ";

/**
 * Single-flight lease. Only one runner (cron tick or admin/manual call) may hold
 * the lease at a time, so two drivers can never claim the same pending rows and
 * double-charge the gateway.
 */
export async function acquireRefingerprintV3Lock(
  supabaseAdmin: AdminClient,
  jobId: string,
  ttlMs: number,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("catalog_jobs")
    .select("note")
    .eq("id", jobId)
    .single();
  if (error) throw new Error(error.message);
  const note = String(data.note ?? "");
  const held = note.match(/\[v3 lock ([^\]]+)\]/);
  if (held) {
    const heldAt = Date.parse(held[1]);
    if (Number.isFinite(heldAt) && Date.now() - heldAt < ttlMs) return false;
  }
  const cleaned = note.replace(/\[v3 lock [^\]]*\]/g, "").trim();
  const { error: writeError } = await supabaseAdmin
    .from("catalog_jobs")
    .update({ note: `${cleaned} ${LOCK_PREFIX}${new Date().toISOString()}]`.trim() })
    .eq("id", jobId);
  if (writeError) throw new Error(writeError.message);
  return true;
}

export async function releaseRefingerprintV3Lock(supabaseAdmin: AdminClient, jobId: string) {
  const { data, error } = await supabaseAdmin
    .from("catalog_jobs")
    .select("note")
    .eq("id", jobId)
    .single();
  if (error) return;
  const cleaned = String(data.note ?? "")
    .replace(/\[v3 lock [^\]]*\]/g, "")
    .trim();
  await supabaseAdmin.from("catalog_jobs").update({ note: cleaned }).eq("id", jobId);
}

export type RefingerprintV3BatchInput = {
  jobId: string;
  model: string;
  batchSize?: number;
  concurrency?: number;
};

type AdminClient = any;
type PendingRow = { id: string; type: string; note: string; ambiguous: boolean };

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

export async function getRefingerprintV3Progress(supabaseAdmin: AdminClient, jobId: string) {
  const count = async (build: (q: any) => any) => {
    const { count: value, error } = await build(
      supabaseAdmin.from("bottles").select("id", { count: "exact", head: true }),
    );
    if (error) throw new Error(error.message);
    return value ?? 0;
  };
  const pendingWithNote = async () => {
    const { count: value, error } = await supabaseAdmin
      .from("bottles")
      .select("id,catalog_source_notes!inner(bottle_id)", { count: "exact", head: true })
      .is("fp_v3_scored_at", null);
    if (error) throw new Error(error.message);
    return value ?? 0;
  };
  const lastWrite = async () => {
    const { data, error } = await supabaseAdmin
      .from("bottles")
      .select("fp_v3_scored_at")
      .not("fp_v3_scored_at", "is", null)
      .order("fp_v3_scored_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.fp_v3_scored_at as string | null) ?? null;
  };
  const jobState = async () => {
    const { data, error } = await supabaseAdmin
      .from("catalog_jobs")
      .select("note")
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return String(data?.note ?? "").includes(REFINGERPRINT_V3_PAUSE_MARKER);
  };
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const fiveMinutesAgo = new Date(Date.now() - 300_000).toISOString();
  const [scored, pending, thin, empty, ambiguous, wrote1m, wrote5m, lastWriteAt, paused] =
    await Promise.all([
      count((q) => q.not("fp_v3_scored_at", "is", null)),
      pendingWithNote(),
      count((q) => q.not("fp_v3_scored_at", "is", null).lte("fp_v3_axes_read", 3)),
      count((q) => q.not("fp_v3_scored_at", "is", null).eq("fp_v3_axes_read", 0)),
      count((q) => q.eq("fp_v3_pipeline", FINGERPRINT_PIPELINE_V3_AMBIGUOUS)),
      count((q) => q.gte("fp_v3_scored_at", oneMinuteAgo)),
      count((q) => q.gte("fp_v3_scored_at", fiveMinutesAgo)),
      lastWrite(),
      jobState(),
    ]);
  return {
    scored,
    pending,
    thin,
    empty,
    ambiguous,
    wrote1m,
    wrote5m,
    rowsPerSecond: wrote5m / 300,
    lastWriteAt,
    paused,
  };
}

export async function setRefingerprintV3Paused(
  supabaseAdmin: AdminClient,
  jobId: string,
  paused: boolean,
) {
  const { data, error } = await supabaseAdmin
    .from("catalog_jobs")
    .select("note")
    .eq("id", jobId)
    .single();
  if (error) throw new Error(error.message);
  const current = String(data.note ?? "")
    .replaceAll(REFINGERPRINT_V3_PAUSE_MARKER, "")
    .trim();
  const note = paused ? `${current} ${REFINGERPRINT_V3_PAUSE_MARKER}`.trim() : current;
  const { error: writeError } = await supabaseAdmin
    .from("catalog_jobs")
    .update({ note })
    .eq("id", jobId);
  if (writeError) throw new Error(writeError.message);
  return { paused };
}

export async function runRefingerprintV3Batch(
  supabaseAdmin: AdminClient,
  key: string,
  input: RefingerprintV3BatchInput,
) {
  const size = input.batchSize ?? REFINGERPRINT_V3_BATCH_SIZE;
  const lanes = input.concurrency ?? REFINGERPRINT_V3_CONCURRENCY;
  const { data: rows, error: readError } = await supabaseAdmin
    .from("bottles")
    .select("id,type,catalog_source_notes!inner(note,ambiguous)")
    .is("fp_v3_scored_at", null)
    .order("id", { ascending: true })
    .limit(size);
  if (readError) throw new Error(readError.message);

  const firstNote = (row: any) =>
    Array.isArray(row.catalog_source_notes)
      ? row.catalog_source_notes[0]
      : row.catalog_source_notes;
  const batch: PendingRow[] = (rows ?? [])
    .map((row: any) => {
      const sourceNote = firstNote(row) ?? {};
      return {
        id: row.id as string,
        type: row.type as string,
        note: String(sourceNote.note ?? ""),
        ambiguous: Boolean(sourceNote.ambiguous),
      };
    })
    .filter((row: PendingRow) => row.note.trim().length >= 20);
  const errors: string[] = [];
  let wrote = 0;
  let empty = 0;
  let ambiguousWrote = 0;

  await mapLimit<PendingRow>(batch, lanes, async (row) => {
    let fp: Record<string, number | null> | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await scoreFromNoteV3(row.type, row.note, key, input.model);
        fp = result.fp as Record<string, number | null>;
        break;
      } catch (error: any) {
        const message = error?.message ?? String(error);
        if (attempt === 2) errors.push(`${row.id}: ${message}`);
        else await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
    const values = fp ?? Object.fromEntries(V3_AXES.map((axis) => [axis, null]));
    const axesReadCount = V3_AXES.reduce(
      (count, axis) => (typeof values[axis] === "number" ? count + 1 : count),
      0,
    );
    if (fp == null) empty++;
    const patch: Record<string, string | number | null> = {
      fp_v3_scored_at: new Date().toISOString(),
      fp_v3_job_id: input.jobId,
      fp_v3_axes_read: axesReadCount,
      fp_v3_pipeline: row.ambiguous
        ? FINGERPRINT_PIPELINE_V3_AMBIGUOUS
        : FINGERPRINT_PIPELINE_V3,
    };
    for (const axis of V3_AXES) patch[`fp_${axis}_v3`] = values[axis];
    const { error: writeError } = await supabaseAdmin
      .from("bottles")
      .update(patch as never)
      .eq("id", row.id);
    if (writeError) errors.push(`${row.id} write: ${writeError.message}`);
    else {
      wrote++;
      if (row.ambiguous) ambiguousWrote++;
    }
  });

  const { count: remaining, error: remainingError } = await supabaseAdmin
    .from("bottles")
    .select("id,catalog_source_notes!inner(bottle_id)", { count: "exact", head: true })
    .is("fp_v3_scored_at", null);
  if (remainingError) throw new Error(remainingError.message);
  return {
    pipeline: FINGERPRINT_PIPELINE_V3,
    model: input.model,
    picked: batch.length,
    wrote,
    ambiguousWrote,
    empty,
    remaining: remaining ?? 0,
    errors: errors.slice(0, 10),
  };
}