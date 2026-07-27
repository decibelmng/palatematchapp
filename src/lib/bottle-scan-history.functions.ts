// Persist bottle scans into the shared scans table, kind='bottle'.
//
// Corrections are the ground-truth signal — every field a user fixes is
// logged append-only with both the original and the corrected value.
// The final value is patched onto scan_wines for history rendering,
// but the correction log is the source of truth for catalog quality
// work later.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Parsed = z.object({
  producer: z.string().nullable().optional(),
  wine_name: z.string().nullable().optional(),
  vintage: z.number().int().nullable().optional(),
  region: z.string().nullable().optional(),
  grape: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
});

const PersistInput = z.object({
  frontPath: z.string().nullable().optional(),
  backPath: z.string().nullable().optional(),
  rawOcrText: z.string().nullable().optional(),
  parsed: Parsed,
  matchedBottleId: z.string().uuid().nullable().optional(),
});

export const persistBottleScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => PersistInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<{ scanId: string; scanWineId: string }> => {
    const { supabase, userId } = context;

    const { data: scan, error: sErr } = await supabase
      .from("scans")
      .insert({
        user_id: userId,
        kind: "bottle",
        status: "parsed",
        page_count: 1,
        batch_count: 1,
        batches_done: 1,
        image_paths: [],
        front_image_path: data.frontPath ?? null,
        back_image_path: data.backPath ?? null,
      })
      .select("id")
      .single();
    if (sErr || !scan) throw new Error(sErr?.message ?? "Failed to persist scan");

    const { data: wine, error: wErr } = await supabase
      .from("scan_wines")
      .insert({
        scan_id: scan.id,
        user_id: userId,
        batch_index: 0,
        format: "bottle",
        currency: "USD",
        producer: data.parsed.producer ?? null,
        cuvee: data.parsed.wine_name ?? null,
        vintage: data.parsed.vintage ?? null,
        region: data.parsed.region ?? null,
        grape: data.parsed.grape ?? null,
        wine_type: data.parsed.type ?? null,
        raw_ocr_text: data.rawOcrText ?? null,
        matched_bottle_id: data.matchedBottleId ?? null,
      })
      .select("id")
      .single();
    if (wErr || !wine) throw new Error(wErr?.message ?? "Failed to persist scan wine");

    return { scanId: scan.id, scanWineId: wine.id };
  });

const CorrectionField = z.enum(["producer", "cuvee", "vintage", "wine_type", "region", "grape"]);

const CorrectionInput = z.object({
  scanWineId: z.string().uuid(),
  field: CorrectionField,
  oldValue: z.string().nullable().optional(),
  newValue: z.string().nullable().optional(),
});

export const saveBottleScanCorrection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => CorrectionInput.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { error: logErr } = await supabase
      .from("scan_wine_corrections")
      .insert({
        scan_wine_id: data.scanWineId,
        user_id: userId,
        field: data.field,
        old_value: data.oldValue ?? null,
        new_value: data.newValue ?? null,
      });
    if (logErr) throw new Error(logErr.message);

    // Patch the current parsed value. wine_type/vintage need mapping.
    const patch: Record<string, unknown> = {};
    if (data.field === "producer") patch.producer = data.newValue ?? null;
    else if (data.field === "cuvee") patch.cuvee = data.newValue ?? null;
    else if (data.field === "region") patch.region = data.newValue ?? null;
    else if (data.field === "grape") patch.grape = data.newValue ?? null;
    else if (data.field === "wine_type") patch.wine_type = data.newValue ?? null;
    else if (data.field === "vintage") {
      const n = data.newValue ? Number.parseInt(data.newValue, 10) : null;
      patch.vintage = Number.isFinite(n) ? n : null;
    }
    if (Object.keys(patch).length > 0) {
      const { error: uErr } = await (supabase.from("scan_wines") as any)
        .update(patch)
        .eq("id", data.scanWineId)
        .eq("user_id", userId);
      if (uErr) throw new Error(uErr.message);
    }
    return { ok: true };
  });

const MarkRatedInput = z.object({
  scanWineId: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
});

export const markBottleScanRated = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => MarkRatedInput.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("scan_wines")
      .update({ rated_at: new Date().toISOString(), user_rated_stars: data.stars })
      .eq("id", data.scanWineId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
