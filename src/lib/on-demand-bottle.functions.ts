// C2 — On-demand fingerprinting + identity dedup.
//
// Trigger points:
//   1) Confirmed bottle scan with no catalog match.
//   2) List-scan lines that remained unmatched after catalog resolution
//      (backfilled by finalizeScan against the same identity+FP pipeline).
//   3) Friend/user rates a wine not in the catalog.
//
// Rules of record:
//   - Identity dedup uses producer / name-cuvée tokens / exact vintage / type.
//     NEVER the palate scorer — that measures taste-similarity, not sameness.
//   - Bias toward INSERT over merge. Only link when a single strict identity
//     match exists; ambiguous → insert provisional.
//   - Fingerprint via the same LLM pipeline as the base catalog
//     (callFingerprintGateway).
//   - σ-flatness gate: if std across the 8 fp axes < 0.10, the vector is
//     untrustworthy — insert but flag unverified=true and mark the source
//     for review; never treat flat as signal.
//   - Insert with source='on-demand', unverified=true. The bottles_seed_prior
//     trigger freezes fp_*_prior and lowers fp_prior_precision when sigma<0.10.
//   - Axis mapping (ax_* used by lane/style views): ax_body<-fp_body,
//     ax_tannin<-fp_tannin, ax_acidity<-fp_acid, ax_fruit_char<-fp_savory;
//     ax_sweet left to the gateway (LLM-derived) — no fp_* mapping.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  callFingerprintGateway,
  FINGERPRINT_MODEL,
  FINGERPRINT_PROMPT_HASH,
} from "@/lib/fingerprint-prompt";
import { composeBottleName } from "@/lib/wine-name";
import {
  scoreNotelessV3,
  V3_AXES,
  FINGERPRINT_PIPELINE_V3_ONDEMAND,
  FINGERPRINT_MODEL_V3_RUN,
} from "@/lib/fingerprint-prompt-v3";


const WineType = z.enum(["red", "white", "sparkling", "rose", "dessert"]);

const Input = z.object({
  producer: z.string().min(1),
  name: z.string().min(1),
  type: WineType,
  region: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  grape: z.string().nullable().optional(),
  vintage: z.number().int().nullable().optional(),
  price_band: z.string().nullable().optional(),
});

export type OnDemandInput = z.infer<typeof Input>;

export type OnDemandResult = {
  bottle_id: string;
  /** true = we inserted a new provisional bottle; false = linked to existing. */
  created: boolean;
  /** true = fp vector was flat (std < 0.10); flagged for review. */
  flat: boolean;
  /** Source resolution: identity-linked | on-demand-fingerprinted | flat-flagged. */
  reason: "identity-linked" | "on-demand-fingerprinted" | "flat-flagged";
};

// ---- token helpers (identity, not taste) ----
const STOPWORDS = new Set([
  "the","a","an","de","di","du","del","della","el","la","le","les","y","e","and","of",
  "vin","vino","wine","cuvee","cuvée","reserve","reserva","riserva","estate","vineyards",
  "vineyard","winery","cellars","domaine","château","chateau","ch.","tenuta","azienda",
  "agricola","weingut","bodega","bodegas","selection","label","bottling","rosso","bianco",
  "blanc","rouge","rose","rosato","rosado","red","white",
]);
function norm(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tok(s: string | null | undefined): string[] {
  return norm(s).split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** σ across the 8 axes. < 0.10 = flat / untrustworthy. */
export function fpFlatness(fp: Record<string, number>): number {
  const vs = Object.values(fp);
  const m = vs.reduce((s, x) => s + x, 0) / vs.length;
  const v = vs.reduce((s, x) => s + (x - m) * (x - m), 0) / vs.length;
  return Math.sqrt(v);
}

/**
 * Strict identity match: same type + producer token overlap + cuvée/name
 * overlap ≥ ceil(sName.length/2) + exact vintage (when both sides carry one).
 * Returns the single strongest identity-linked row, or null when 0 or ≥2
 * candidates pass (bias to insert on ambiguity).
 *
 * NOTE: identity-only. This function must NOT consider fp_* / taste
 * similarity — merging on style is destructive if wrong.
 */
export function pickIdentityLink(
  input: OnDemandInput,
  cands: Array<{
    id: string; name: string; producer: string | null; type: string | null;
    region: string | null; vintage: number | null;
  }>,
): string | null {
  const sProd = tok(input.producer);
  const sName = tok(input.name);
  const passing: string[] = [];
  for (const r of cands) {
    if (r.type && r.type !== input.type) continue;
    const bProd = tok(r.producer);
    const bName = tok(r.name);
    const prodOv = sProd.filter((t) => bProd.includes(t)).length;
    if (prodOv < 1) continue;
    const needName = Math.max(1, Math.ceil(sName.length / 2));
    const nameOv = sName.filter((t) => bName.includes(t)).length;
    if (sName.length > 0 && nameOv < needName) continue;
    // Vintage: different vintage = different bottle. Only merge when both
    // sides know the vintage AND they match. If either side is unknown,
    // require a fresh insert rather than an ambiguous merge.
    if (input.vintage == null || r.vintage == null) {
      if (input.vintage !== r.vintage) continue; // one known, one null → skip
    } else if (input.vintage !== r.vintage) {
      continue;
    }
    passing.push(r.id);
  }
  return passing.length === 1 ? passing[0] : null;
}

/**
 * Core resolve-or-create routine. Plain async function so other server
 * functions (finalizeScan backfill, add-bottle, feed) can share the same
 * identity+FP+insert path without a nested server-fn RPC hop.
 *
 * The caller passes an authenticated supabase client (RLS as the user); we
 * insert via that client so `added_by` and RLS behave normally. `userId` is
 * only used for the `added_by` column on new rows.
 */
export async function resolveOrCreateOnDemandCore(
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    from: (t: string) => any;
  },
  userId: string,
  apiKey: string,
  input: OnDemandInput,
): Promise<OnDemandResult> {
  // 0) Name normalisation — CHOKE POINT for all three trigger paths.
  // A caller that had no cuvée may have handed us the region as the name.
  // Storing that breaks identity dedup (see composeBottleName), so rewrite it
  // to producer + grape BEFORE dedup, fingerprint and insert all use it.
  input = {
    ...input,
    name: composeBottleName({
      producer: input.producer,
      cuvee: input.name,
      region: input.region ?? null,
      grape: input.grape ?? null,
    }),
  };

  // 1) Identity dedup (fuzzy candidate pool, strict identity filter — NOT taste).
  const q = [input.producer, input.name].join(" ").trim();
  const { data: cands } = await supabase.rpc("search_bottles_fuzzy", {
    q, type_variants: [input.type], lim: 12, threshold: 0.25,
  });
  const linkedId = pickIdentityLink(
    input,
    (cands ?? []) as Array<{
      id: string; name: string; producer: string | null; type: string | null;
      region: string | null; vintage: number | null;
    }>,
  );
  if (linkedId) {
    return { bottle_id: linkedId, created: false, flat: false, reason: "identity-linked" };
  }

  // 2) Fingerprint via shared LLM pipeline (SAME prompt as base catalog).
  const { fp, ax_sweet, tasting_note } = await callFingerprintGateway({
    producer: input.producer,
    name: input.name,
    type: input.type,
    region: input.region ?? null,
    country: input.country ?? null,
    grape: input.grape ?? null,
    vintage: input.vintage ?? null,
  }, apiKey);

  // 3) σ-flatness gate.
  const flat = fpFlatness(fp) < 0.10;

  // 3b) v3 SHADOW reading, taken at insert.
  //
  // Post-swap the catalog is pure v3, and a row inserted on the v2 scale is
  // permanently on the wrong scale unless something re-scores it. Writing the
  // shadow columns here means there is no flag day: before the swap the live
  // fp_* stay v2 (so this row is calibrated like the catalog it is ranked
  // against today), and the moment the swap copies fp_*_v3 -> fp_*, this row
  // comes with it. A gap of a day costs nothing.
  //
  // The reading is blind — the v3 scorer sees only the type and the note the v2
  // gateway just wrote — and is stamped on_demand_v3_generated, because a
  // generated note is measurably second-class against recovered human reviews.
  // This call must never fail a resolve: a missing shadow reading leaves the row
  // pending for the note-less batch, which is the same outcome as today.
  let v3: Awaited<ReturnType<typeof scoreNotelessV3>> | null = null;
  try {
    if (tasting_note && tasting_note.trim().length >= 40) {
      v3 = await scoreNotelessV3(
        {
          producer: input.producer, name: input.name, type: input.type,
          region: input.region ?? null, country: input.country ?? null,
          grape: input.grape ?? null, vintage: input.vintage ?? null,
        },
        apiKey,
        FINGERPRINT_MODEL_V3_RUN,
        tasting_note,
      );
    }
  } catch {
    v3 = null;
  }
  const v3Patch: Record<string, string | number | null> = v3
    ? {
        ...Object.fromEntries(V3_AXES.map((a) => [`fp_${a}_v3`, v3!.fp[a]])),
        fp_v3_scored_at: new Date().toISOString(),
        fp_v3_pipeline: FINGERPRINT_PIPELINE_V3_ONDEMAND,
        fp_v3_axes_read: V3_AXES.reduce((n, a) => (typeof v3!.fp[a] === "number" ? n + 1 : n), 0),
      }
    : {};

  // 4) Insert provisional bottle. The bottles_seed_prior trigger:
  //    - freezes fp_*_prior <- fp_* on insert
  //    - sets fp_prior_precision = 4·source_w·flat_w (flat_w=0.5 when σ<0.10)
  //    - source_w=1.0 for on-demand (vs 2.0 for base 'LLM-derived calibrated'),
  //      so on-demand priors weigh ~half of base-catalog priors by design.
  //
  // Axis mapping per spec:
  //   ax_body     <- fp.body
  //   ax_tannin   <- fp.tannin
  //   ax_acidity  <- fp.acid
  //   ax_fruit_char <- fp.savory
  //   ax_sweet    <- gateway (untouched by fp_* mapping)
  // Cast: ax_body/ax_tannin/ax_acidity/ax_fruit_char are GENERATED ALWAYS AS
  // (fp_*) STORED after the ax-columns migration. Generated types still list
  // them as required until types.ts regenerates; the runtime rejects writes.
  const { data: row, error } = await supabase
    .from("bottles")
    .insert({
      producer: input.producer.trim(),
      name: input.name.trim(),
      type: input.type,
      region: input.region?.trim() || null,
      country: input.country?.trim() || null,
      grape: input.grape?.trim() || null,
      vintage: input.vintage ?? null,
      price_band: input.price_band?.trim() || null,
      fp_fresh: fp.fresh, fp_acid: fp.acid, fp_tannin: fp.tannin,
      fp_fruit_dark: fp.fruit_dark, fp_ripe: fp.ripe, fp_oak: fp.oak,
      fp_body: fp.body, fp_savory: fp.savory,
      ax_sweet,
      tasting_note,
      source: flat ? "on-demand; flat-fingerprint flagged" : "on-demand",
      unverified: true,
      added_by: userId,
      // Provenance — NOT NULL columns. On-demand uses the blinded_v2 pipeline
      // but a distinct pipeline label so cohort queries can separate it from
      // bulk re-fingerprint runs.
      fp_model: FINGERPRINT_MODEL,
      fp_prompt_hash: FINGERPRINT_PROMPT_HASH,
      fp_pipeline: "on_demand_blinded_v2",
      fp_scored_at: new Date().toISOString(),
      ...v3Patch,
    } as never)

    .select("id")
    .single();
  if (error) throw new Error((error as { message?: string }).message ?? "on-demand insert failed");

  return {
    bottle_id: row.id as string,
    created: true,
    flat,
    reason: flat ? "flat-flagged" : "on-demand-fingerprinted",
  };
}

export const resolveOrCreateOnDemand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }): Promise<OnDemandResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    return resolveOrCreateOnDemandCore(context.supabase as any, context.userId, key, data);
  });
