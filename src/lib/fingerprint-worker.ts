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
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { skipped: true, reason: "missing LOVABLE_API_KEY" };

  if (!key) return { skipped: true, reason: "missing LOVABLE_API_KEY" };

  // 1. Fetch the seed bottle.
  const { data: seed, error: sErr } = await supabaseAdmin
    .from("bottles")
    .select(
      "id,producer,name,type,region,country,grape,source,refingerprinted_at,fingerprint_attempts",
    )
    .eq("id", bottleId)
    .maybeSingle();
  if (sErr) return { skipped: true, reason: sErr.message };
  if (!seed) return { skipped: true, reason: "bottle not found" };

  // 2. Fetch all rows sharing this producer (cuvée group is a subset).
  const { data: sibs, error: bErr } = await supabaseAdmin
    .from("bottles")
    .select("id,producer,name,type,region,refingerprinted_at,source,fingerprint_attempts")
    .eq("producer", seed.producer ?? "");
  if (bErr) return { skipped: true, reason: bErr.message };

  const seedType = (seed.type ?? "").toLowerCase();
  const seedRegion = (seed.region ?? "").toLowerCase();
  const seedName = stripYear((seed.name ?? "").toLowerCase());

  const group = (sibs ?? []).filter(
    (r: any) =>
      stripYear((r.name ?? "").toLowerCase()) === seedName &&
      (r.type ?? "").toLowerCase() === seedType &&
      (r.region ?? "").toLowerCase() === seedRegion,
  );

  if (group.length === 0) return { skipped: true, reason: "empty group" };
  if (group.length > CUVEE_GROUP_MAX) {
    return { skipped: true, reason: `group too large (${group.length})` };
  }

  // 3. Eligibility is PER ROW, not per group. The old guard skipped when ANY
  // row in the cuvée group was stamped, so a newly inserted vintage joining a
  // stamped group was permanently ineligible — one scoring attempt per wine
  // per lifetime. The only thing that disqualifies a row is that row already
  // having a fingerprint, or having burned its retry ceiling.
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
  if (targets.length === 0) return { skipped: true, reason: "empty group" };

  // 3b. Record the ATTEMPT before the call. refingerprinted_at only writes on
  // success, so a gateway failure used to leave no trace — indistinguishable
  // from never having been tried, while the rating that triggered it fires
  // once and never again.
  const attemptAt = new Date().toISOString();
  await supabaseAdmin
    .from("bottles")
    .update({
      fingerprint_attempts: (seed.fingerprint_attempts ?? 0) + 1,
      last_attempt_at: attemptAt,
    })
    .eq("id", seed.id);

  // 4. One calibrated gateway call, no vintage.
  const { fp, ax_sweet } = await callFingerprintGateway(
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

  // 5. Write to every row in the group. Provenance columns are NOT NULL —
  // every fp_ write must record model + prompt hash + pipeline + scored_at.
  const ids = targets.map((r: any) => r.id as string);
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

  if (uErr) return { skipped: true, reason: uErr.message };

  return { ok: true, groupSize: ids.length };
}
