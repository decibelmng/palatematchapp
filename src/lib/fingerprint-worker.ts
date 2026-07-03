// Shared cuvée re-fingerprint worker. Consumed by:
//   - src/lib/admin-refingerprint.functions.ts (bulk admin queue)
//   - src/lib/fingerprint-refresh.functions.ts (self-healing on rating)
//
// The supabaseAdmin client is passed in so this module has no server-only
// imports at module scope (safe to import from *.functions.ts).

import { callFingerprintGateway } from "@/lib/fingerprint-prompt";

const CUVEE_GROUP_MAX = 40;

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
): Promise<CuveeResult> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return { skipped: true, reason: "missing LOVABLE_API_KEY" };

  // 1. Fetch the seed bottle.
  const { data: seed, error: sErr } = await supabaseAdmin
    .from("bottles")
    .select(
      "id,producer,name,type,region,country,grape,source,refingerprinted_at",
    )
    .eq("id", bottleId)
    .maybeSingle();
  if (sErr) return { skipped: true, reason: sErr.message };
  if (!seed) return { skipped: true, reason: "bottle not found" };

  // 2. Fetch all rows sharing this producer (cuvée group is a subset).
  const { data: sibs, error: bErr } = await supabaseAdmin
    .from("bottles")
    .select("id,producer,name,type,region,refingerprinted_at,source")
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

  // 3. Natural guard: if any row is already stamped, cuvée has been re-scored.
  if (group.some((r: any) => r.refingerprinted_at)) {
    return { skipped: true, reason: "already refingerprinted" };
  }

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

  // 5. Write to every row in the group.
  const ids = group.map((r: any) => r.id as string);
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
      refingerprinted_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (uErr) return { skipped: true, reason: uErr.message };

  return { ok: true, groupSize: ids.length };
}
