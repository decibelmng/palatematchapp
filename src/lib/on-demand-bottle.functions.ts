// C2 — On-demand fingerprinting + identity dedup.
//
// Trigger points:
//   1) Confirmed bottle scan with no catalog match.
//   2) Friend rates a wine not in the catalog (feed scoring path).
//   3) Any resolution path that lands on an unknown wine.
//
// Rules of record:
//   - Identity dedup uses producer / name-cuvée tokens / exact vintage / type.
//     NEVER the palate scorer — that measures taste-similarity, not sameness.
//   - Bias toward INSERT over merge. Only link when a single strict identity
//     match exists; ambiguous → insert provisional.
//   - Fingerprint via the same LLM pipeline as the base catalog
//     (callFingerprintGateway).
//   - σ-flatness gate: if std across the 8 fp axes < 0.10, the vector is
//     untrustworthy — insert but flag unverified=true; never treat flat as signal.
//   - Insert with source='on-demand', unverified=true, low fp_prior_precision.
//     The bottles_seed_prior trigger freezes fp_*_prior automatically.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callFingerprintGateway } from "@/lib/fingerprint-prompt";

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
function fpFlatness(fp: Record<string, number>): number {
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
 */
function pickIdentityLink(
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
    // vintage: if both present, must match exactly. If either null, allow.
    if (input.vintage != null && r.vintage != null && input.vintage !== r.vintage) continue;
    passing.push(r.id);
  }
  return passing.length === 1 ? passing[0] : null;
}

export const resolveOrCreateOnDemand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }): Promise<OnDemandResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { supabase, userId } = context;

    // ---- 1. Identity dedup (fuzzy candidate pool, strict identity filter) ----
    const q = [data.producer, data.name].join(" ").trim();
    const { data: cands } = await supabase.rpc("search_bottles_fuzzy", {
      q, type_variants: [data.type], lim: 12, threshold: 0.25,
    });
    const linkedId = pickIdentityLink(
      data,
      (cands ?? []) as Array<{
        id: string; name: string; producer: string | null; type: string | null;
        region: string | null; vintage: number | null;
      }>,
    );
    if (linkedId) {
      return { bottle_id: linkedId, created: false, flat: false, reason: "identity-linked" };
    }

    // ---- 2. Fingerprint via shared LLM pipeline ----
    const { fp, ax_sweet, tasting_note } = await callFingerprintGateway({
      producer: data.producer,
      name: data.name,
      type: data.type,
      region: data.region ?? null,
      country: data.country ?? null,
      grape: data.grape ?? null,
      vintage: data.vintage ?? null,
    }, key);

    // ---- 3. σ-flatness gate ----
    const flat = fpFlatness(fp) < 0.10;

    // ---- 4. Insert provisional bottle ----
    // Low precision for on-demand: prior weight ~1 (vs default 4, expert 8).
    // Flat flag pushes precision even lower so the correction spine treats
    // this vector as thin evidence pending review.
    const precision = flat ? 0.5 : 1.0;
    const { data: row, error } = await supabase
      .from("bottles")
      .insert({
        producer: data.producer.trim(),
        name: data.name.trim(),
        type: data.type,
        region: data.region?.trim() || null,
        country: data.country?.trim() || null,
        grape: data.grape?.trim() || null,
        vintage: data.vintage ?? null,
        price_band: data.price_band?.trim() || null,
        fp_fresh: fp.fresh, fp_acid: fp.acid, fp_tannin: fp.tannin,
        fp_fruit_dark: fp.fruit_dark, fp_ripe: fp.ripe, fp_oak: fp.oak,
        fp_body: fp.body, fp_savory: fp.savory,
        ax_body: fp.body, ax_fruit_char: fp.fruit_dark,
        ax_tannin: fp.tannin, ax_acidity: fp.acid, ax_sweet,
        tasting_note,
        source: flat ? "on-demand; flat-fingerprint flagged" : "on-demand",
        unverified: true,
        fp_prior_precision: precision,
        added_by: userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return {
      bottle_id: row.id,
      created: true,
      flat,
      reason: flat ? "flat-flagged" : "on-demand-fingerprinted",
    };
  });
