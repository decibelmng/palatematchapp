// Shared cuvée re-fingerprint worker. Consumed by:
//   - src/lib/admin-refingerprint.functions.ts (bulk admin queue)
//   - src/lib/fingerprint-refresh.functions.ts (self-healing on rating)
//
// The supabaseAdmin client is passed in so this module has no server-only
// imports at module scope (safe to import from *.functions.ts).

import {
  callFingerprintGateway,
  FINGERPRINT_MODEL,
  FINGERPRINT_PROMPT_HASH,
  FINGERPRINT_PIPELINE,
} from "@/lib/fingerprint-prompt";


const CUVEE_GROUP_MAX = 40;

/** Stop trying after this many attempts on the same row. A permanently
 *  unscoreable wine must not burn gateway budget every session. */
export const MAX_FINGERPRINT_ATTEMPTS = 3;

/** Advance the attempt counter for every row we were about to score.
 *  Uses an RPC so the whole target set moves in one statement — incrementing
 *  only the seed left siblings at 0 attempts, which the sweep then re-picked. */
async function bumpAttempts(supabaseAdmin: any, ids: string[], why: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc("bump_fingerprint_attempts", { _ids: ids });
  if (error) {
    console.error(
      `[refingerprint] could not record ${why} for ${ids.length} row(s): ${error.message}`,
    );
  }
}

export function stripYear(s: string): string {
  return s.replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
}

export type CuveeResult =
  | { ok: true; groupSize: number }
  | { skipped: true; reason: string };

// Look up the bottle's cuvée group (producer|stripped(name)|type|region),
// call the calibrated gateway once (no vintage), and write fp_*/ax_* +
// refingerprinted_at to every row in the group.
export async function refingerprintCuveeByBottleId(
  bottleId: string,
  supabaseAdmin: any,
  jobId: string | null = null,
): Promise<CuveeResult> {
  // Every exit path from here logs at error level and, where the failure is
  // attributable to a row, advances that row's attempt counter. A skip that
  // leaves the counter untouched is indistinguishable from "never tried" and
  // can be retried every session forever — the exact shape of the bug the
  // retry ceiling exists to prevent.
  const fail = async (reason: string, ids: string[] | null): Promise<CuveeResult> => {
    console.error(`[refingerprint] ${bottleId} skipped: ${reason}`);
    if (ids && ids.length > 0) await bumpAttempts(supabaseAdmin, ids, reason);
    return { skipped: true, reason };
  };

  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { skipped: true, reason: "missing LOVABLE_API_KEY" };

  // 1. Fetch the seed bottle.
  const { data: seed, error: sErr } = await supabaseAdmin
    .from("bottles")
    .select(
      "id,producer,name,type,region,country,grape,source,refingerprinted_at,fingerprint_attempts",
    )
    .eq("id", bottleId)
    .maybeSingle();
  if (sErr) return fail(sErr.message, [bottleId]);
  if (!seed) return fail("bottle not found", null);

  // 2. Fetch all rows sharing this producer (cuvée group is a subset).
  const { data: sibs, error: bErr } = await supabaseAdmin
    .from("bottles")
    .select("id,producer,name,type,region,refingerprinted_at,source,fingerprint_attempts")
    .eq("producer", seed.producer ?? "");
  if (bErr) return fail(bErr.message, [seed.id]);

  const seedType = (seed.type ?? "").toLowerCase();
  const seedRegion = (seed.region ?? "").toLowerCase();
  const seedName = stripYear((seed.name ?? "").toLowerCase());

  const group = (sibs ?? []).filter(
    (r: any) =>
      stripYear((r.name ?? "").toLowerCase()) === seedName &&
      (r.type ?? "").toLowerCase() === seedType &&
      (r.region ?? "").toLowerCase() === seedRegion,
  );

  // Structural skips. These recur identically on every retry, so they MUST
  // count against the ceiling or the sweep re-picks the same row every session.
  if (group.length === 0) return fail("empty group", [seed.id]);
  if (group.length > CUVEE_GROUP_MAX) {
    return fail(`group too large (${group.length})`, [seed.id]);
  }

  // 3. Eligibility is PER ROW, not per group. The old guard skipped when ANY
  // row in the cuvée group was stamped, so a newly inserted vintage joining a
  // stamped group was permanently ineligible — one scoring attempt per wine
  // per lifetime. The only thing that disqualifies a row is that row already
  // having a fingerprint, or having burned its retry ceiling.
  //
  // Neither of these is a failure, so neither logs or increments.
  if (seed.refingerprinted_at) {
    return { skipped: true, reason: "already refingerprinted" };
  }
  if ((seed.fingerprint_attempts ?? 0) >= MAX_FINGERPRINT_ATTEMPTS) {
    return {
      skipped: true,
      reason: `retry ceiling reached (${seed.fingerprint_attempts} attempts)`,
    };
  }

  // Write to the unstamped rows only, so sharing one gateway call across the
  // cuvée never overwrites a row that already has its own reading.
  const targets = group.filter((r: any) => !r.refingerprinted_at);
  if (targets.length === 0) return fail("empty group", [seed.id]);
  const targetIds = targets.map((r: any) => r.id as string);

  // 3b. Record the ATTEMPT before the call, across the WHOLE target set. Only
  // the seed used to be incremented, so a sibling could be re-picked by the
  // sweep at 0 attempts and drive the same failing gateway call again.
  await bumpAttempts(supabaseAdmin, targetIds, "attempt");

  // 4. One calibrated gateway call, no vintage. A throw here is a failure of a
  // catalog write, not of one person's request — it is logged, never swallowed.
  let fp: any;
  let ax_sweet: number;
  try {
    const res = await callFingerprintGateway(
      {
        producer: seed.producer ?? "",
        name: stripYear(seed.name ?? ""),
        type: (seed.type as any) ?? "red",
        region: seed.region,
        country: seed.country,
        grape: seed.grape,
        vintage: null,
      },
      key,
    );
    fp = res.fp;
    ax_sweet = res.ax_sweet;
  } catch (e: any) {
    // Attempts were already recorded above, so this failure is visible in
    // fingerprint_attempts / last_attempt_at as well as the log.
    console.error(
      `[refingerprint] gateway failed for ${seed.producer} ${seed.name} (${targetIds.length} rows): ${e?.message ?? e}`,
    );
    return { skipped: true, reason: `gateway: ${e?.message ?? String(e)}` };
  }


  // 5. Write to every row in the group. Provenance columns are NOT NULL —
  // every fp_ write must record model + prompt hash + pipeline + scored_at.
  const ids = targetIds;
  const nowIso = new Date().toISOString();
  const { error: uErr } = await supabaseAdmin
    .from("bottles")
    .update({
      fp_fresh: fp.fresh,
      fp_acid: fp.acid,
      fp_tannin: fp.tannin,
      fp_fruit_dark: fp.fruit_dark,
      fp_ripe: fp.ripe,
      fp_oak: fp.oak,
      fp_body: fp.body,
      fp_savory: fp.savory,
      ax_body: fp.body,
      ax_fruit_char: fp.savory,
      ax_tannin: fp.tannin,
      ax_acidity: fp.acid,
      ax_sweet,
      source: seed.source
        ? `${seed.source}; refingerprinted (cuvée-level)`
        : "refingerprinted (cuvée-level)",
      refingerprinted_at: nowIso,
      fp_model: FINGERPRINT_MODEL,
      fp_prompt_hash: FINGERPRINT_PROMPT_HASH,
      fp_pipeline: FINGERPRINT_PIPELINE,
      fp_scored_at: nowIso,
      fp_job_id: jobId,
    })
    .in("id", ids);

  if (uErr) {
    console.error(
      `[refingerprint] write failed for ${seed.producer} ${seed.name} (${ids.length} rows): ${uErr.message}`,
    );
    return { skipped: true, reason: uErr.message };
  }

  return { ok: true, groupSize: ids.length };
}
