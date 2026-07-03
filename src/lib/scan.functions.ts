import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FpSchema = z.object({
  fresh: z.number(), acid: z.number(), tannin: z.number(), fruit_dark: z.number(),
  ripe: z.number(), oak: z.number(), body: z.number(), savory: z.number(),
});

const WineSchema = z.object({
  producer: z.string().nullable().optional(),
  wine_name: z.string().nullable().optional(),
  vintage: z.number().int().nullable().optional(),
  region: z.string().nullable().optional(),
  grape: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  type: z.enum(["red", "white", "sparkling", "rose", "dessert"]).nullable().optional(),
  fp: FpSchema.nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).nullable().optional(),
});

export type ScannedWine = z.infer<typeof WineSchema>;

export type ResolvedWine = ScannedWine & {
  fp_resolved: z.infer<typeof FpSchema> | null;
  fp_source: "catalog" | "estimated" | "unreadable";
  matched_bottle_id: string | null;
  matched_bottle_name: string | null;
  match_score: number;
  match_reasons?: string[];
};

const PROMPT = `You are reading a photo of a restaurant wine list. Return ONLY valid JSON — no prose, no markdown fences. Read EVERY wine visible on the list.

For each wine, output an object with:
  producer, wine_name, vintage (int or null), region, grape, price (string or null)
  type: "red" | "white" | "sparkling" | "rose" | "dessert" — classify each wine.
  fp: eight CALIBRATED style values 0..1 — fresh, acid, tannin, fruit_dark, ripe, oak, body, savory. DO NOT default to 0.5.
  confidence: "high" | "medium" | "low"

Rules:
- Include every wine, even if you must guess. If a line is illegible, omit it.
- For white, rosé, and sparkling wines, tannin and fruit_dark MUST be 0. For dessert wines: white dessert (Sauternes, Tokaji, ice wine) tannin 0; fortified reds (Port, Banyuls, Maury) use real tannin values (typically 0.5–0.8).
- Do NOT invent wines that aren't on the list.
- Keep each object COMPACT — short strings only, no extra keys.
- Output shape: { "wines": [ { ... }, ... ] }`;

const ImageSchema = z.object({
  image_base64: z.string().min(100),
  media_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic"]),
});

// ---------- Matching helpers ----------

const STOPWORDS = new Set([
  "the","a","an","de","di","du","del","della","el","la","le","les","y","e","and","of",
  "vin","vino","wine","cuvee","cuvée","reserve","reserva","riserva","estate","vineyards",
  "vineyard","winery","cellars","domaine","château","chateau","ch.","tenuta","azienda",
  "agricola","weingut","bodega","bodegas","selection","label","bottling","rosso","bianco",
  "blanc","rouge","rose","rosato","rosado","red","white",
]);

function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string | null | undefined): string[] {
  return normalize(s).split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}
function typeMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "red").toLowerCase() === (b ?? "red").toLowerCase();
}
function scoreMatch(
  scanned: ScannedWine,
  bottle: { name: string; producer: string | null; type: string | null; vintage: number | null },
): number {
  if (!typeMatches(scanned.type, bottle.type)) return 0;
  const sProd = tokens(scanned.producer);
  const sName = tokens(scanned.wine_name);
  const bProd = tokens(bottle.producer);
  const bName = tokens(bottle.name);
  const prodOverlap = sProd.filter((t) => bProd.includes(t) || bName.includes(t)).length;
  const nameOverlap = sName.filter((t) => bName.includes(t) || bProd.includes(t)).length;
  const haveProd = sProd.length > 0;
  const needNameMatch = Math.max(1, Math.ceil(sName.length / 2));
  if (haveProd && prodOverlap < 1) return 0;
  if (!haveProd && (sName.length + prodOverlap) < 2) return 0;
  if (sName.length > 0 && nameOverlap < needNameMatch) return 0;
  const prodScore = haveProd ? Math.min(1, prodOverlap / Math.max(1, sProd.length)) : 0.5;
  const nameScore = sName.length > 0 ? nameOverlap / sName.length : 0.5;
  return Math.min(1, 0.6 + 0.25 * prodScore + 0.15 * nameScore);
}

// ---------- JSON repair ----------

function repairAndParse(raw: string): unknown {
  let s = raw.trim();
  // Strip markdown fences
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  try { return JSON.parse(s); } catch {}
  // Walk string, track brackets/quotes
  let inStr = false, esc = false;
  const stack: string[] = [];
  let lastGoodComma = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
    else if (ch === "," && stack.length > 0) lastGoodComma = i;
  }
  let repaired = s;
  if (inStr) {
    // Cut back to last comma at top of array/object, then close.
    if (lastGoodComma > 0) repaired = s.slice(0, lastGoodComma);
    else repaired = s + '"';
    // Recompute stack
    inStr = false; esc = false; stack.length = 0;
    for (let i = 0; i < repaired.length; i++) {
      const ch = repaired[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") stack.push("}");
      else if (ch === "[") stack.push("]");
      else if (ch === "}" || ch === "]") stack.pop();
    }
  }
  while (stack.length) repaired += stack.pop();
  return JSON.parse(repaired);
}

// ---------- Vision + resolve (shared) ----------

async function callVision(images: z.infer<typeof ImageSchema>[], apiKey: string) {
  const imageBlocks = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.media_type};base64,${img.image_base64}` },
  }));
  const intro = images.length > 1
    ? `${PROMPT}\n\nNOTE: ${images.length} photos of the SAME wine list (multiple pages). Combine into ONE array; deduplicate.`
    : PROMPT;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: 8000,
      messages: [{ role: "user", content: [{ type: "text", text: intro }, ...imageBlocks] }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Rate limited — try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted on this workspace.");
    throw new Error(`Vision call failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  const finishReason: string | undefined = json?.choices?.[0]?.finish_reason;
  return { content, finishReason };
}

async function extractWinesWithRetry(images: z.infer<typeof ImageSchema>[], apiKey: string): Promise<ScannedWine[]> {
  const attempt = async (imgs: z.infer<typeof ImageSchema>[]) => {
    const { content, finishReason } = await callVision(imgs, apiKey);
    let parsed: unknown;
    try { parsed = JSON.parse(content); }
    catch {
      try { parsed = repairAndParse(content); }
      catch { throw new Error(`Truncated or invalid JSON (finish=${finishReason ?? "?"})`); }
    }
    const shape = z.object({ wines: z.array(WineSchema) }).safeParse(parsed);
    if (!shape.success) throw new Error("Vision returned an unexpected shape.");
    return shape.data.wines;
  };
  try {
    return await attempt(images);
  } catch (e) {
    // Truncated? If we sent >1 image, split into single-page calls and merge.
    if (images.length > 1) {
      const parts = await Promise.all(images.map((img) => attempt([img])));
      return parts.flat();
    }
    throw e;
  }
}

async function resolveAgainstCatalog(
  wines: ScannedWine[],
  supabase: any,
): Promise<ResolvedWine[]> {
  return Promise.all(wines.map(async (w): Promise<ResolvedWine> => {
    if (!w.fp) {
      return { ...w, fp_resolved: null, fp_source: "unreadable", matched_bottle_id: null, matched_bottle_name: null, match_score: 0 };
    }
    const q = [w.producer, w.wine_name].filter(Boolean).join(" ").trim();
    let best: { row: any; score: number } | null = null;
    if (q.length >= 3) {
      const { data: candidates } = await supabase.rpc("search_bottles_fuzzy", {
        q, type_variants: w.type ? [w.type as string] : undefined, lim: 8, threshold: 0.25,
      });
      for (const row of (candidates ?? []) as any[]) {
        const s = scoreMatch(w, row);
        if (s > 0 && (!best || s > best.score)) best = { row, score: s };
      }
    }
    if (best) {
      const r = best.row;
      return {
        ...w,
        fp_resolved: {
          fresh: r.fp_fresh, acid: r.fp_acid, tannin: r.fp_tannin,
          fruit_dark: r.fp_fruit_dark, ripe: r.fp_ripe, oak: r.fp_oak,
          body: r.fp_body, savory: r.fp_savory,
        },
        fp_source: "catalog",
        matched_bottle_id: r.id,
        matched_bottle_name: [r.producer, r.name, r.vintage].filter(Boolean).join(" "),
        match_score: best.score,
      };
    }
    return { ...w, fp_resolved: w.fp, fp_source: "estimated", matched_bottle_id: null, matched_bottle_name: null, match_score: 0 };
  }));
}

// ---------- Server functions: scan lifecycle ----------

const StringArray = z.array(z.string()).default([]);

export const createScanRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    page_count: z.number().int().min(1).max(8),
    batch_count: z.number().int().min(1).max(8),
    image_paths: StringArray.optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inserted, error } = await supabase.from("scans").insert({
      user_id: userId,
      status: "processing",
      page_count: data.page_count,
      batch_count: data.batch_count,
      image_paths: data.image_paths ?? [],
    }).select("id").single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to create scan");
    return { scan_id: inserted.id as string };
  });

export const scanWineBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    scan_id: z.string().uuid(),
    batch_index: z.number().int().min(0),
    images: z.array(ImageSchema).min(1).max(2),
    image_paths: StringArray.optional(),
  }).parse(input))
  .handler(async ({ data, context }): Promise<{ batch_index: number; wines: ResolvedWine[] }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const { supabase, userId } = context;

    // Ownership check (RLS-scoped; nonexistent OR not owned both return null).
    const { data: owned } = await supabase
      .from("scans").select("id").eq("id", data.scan_id).maybeSingle();
    if (!owned) throw new Error("Scan not found");

    try {
      const raw = await extractWinesWithRetry(data.images, key);
      const resolved = await resolveAgainstCatalog(raw, supabase);

      // Persist immediately
      if (resolved.length > 0) {
        const rows = resolved.map((w) => ({
          scan_id: data.scan_id,
          user_id: userId,
          batch_index: data.batch_index,
          producer: w.producer ?? null,
          cuvee: w.wine_name ?? null,
          vintage: w.vintage ?? null,
          wine_type: w.type ?? null,
          region: w.region ?? null,
          grape: w.grape ?? null,
          price: w.price ?? null,
          raw_json: w as any,
          fp: (w.fp_resolved ?? null) as any,
          fp_source: w.fp_source,
          matched_bottle_id: w.matched_bottle_id,
          match_score: w.match_score,
          match_reasons: (w.match_reasons ?? []) as any,
        }));
        await supabase.from("scan_wines").insert(rows);
      }

      await supabase.rpc("mark_scan_batch_done", { p_scan_id: data.scan_id, p_batch_index: data.batch_index });

      return { batch_index: data.batch_index, wines: resolved };
    } catch (e) {
      await supabase.rpc("mark_scan_batch_failed", { p_scan_id: data.scan_id, p_batch_index: data.batch_index });
      throw e;
    }
  });

export const finalizeScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ scan_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: scan } = await supabase.from("scans")
      .select("batches_done,batch_count,batches_failed,image_paths")
      .eq("id", data.scan_id).single();
    if (!scan) throw new Error("Scan not found");
    const failed = ((scan.batches_failed ?? []) as number[]);
    const done = scan.batches_done ?? 0;
    const total = scan.batch_count ?? 0;
    let status: "processing" | "partial" | "complete" | "failed";
    if (done === total && failed.length === 0) status = "complete";
    else if (done > 0 && failed.length > 0) status = "partial";
    else if (done === 0 && failed.length > 0) status = "failed";
    else status = "processing";
    await supabase.from("scans").update({ status }).eq("id", data.scan_id);

    // Mirror aggregated wines into scan_logs for existing restaurant-attribution flow.
    const { data: rows } = await supabase.from("scan_wines")
      .select("producer,cuvee,vintage,region,grape,price,wine_type,fp,fp_source,matched_bottle_id")
      .eq("scan_id", data.scan_id);
    const winesForLog = (rows ?? []).map((r: any) => ({
      producer: r.producer, wine_name: r.cuvee, vintage: r.vintage,
      region: r.region, grape: r.grape, price: r.price, type: r.wine_type,
      fp_resolved: r.fp, fp_source: r.fp_source, matched_bottle_id: r.matched_bottle_id,
      matched_bottle_name: null, match_score: 0,
    }));
    let scan_log_id: string | null = null;
    try {
      const { data: log } = await supabase.from("scan_logs").insert({
        user_id: userId,
        n_photos: (scan.image_paths as string[] | null)?.length ?? 0,
        total_wines: winesForLog.length,
        matched_count: winesForLog.filter((w: any) => w.fp_source === "catalog").length,
        estimated_count: winesForLog.filter((w: any) => w.fp_source === "estimated").length,
        unreadable_count: winesForLog.filter((w: any) => !w.fp_resolved).length,
        wines: winesForLog as any,
        image_paths: (scan.image_paths as any) ?? [],
        status,
      }).select("id").single();
      scan_log_id = log?.id ?? null;
    } catch { /* logging best-effort */ }

    return { status, scan_log_id };
  });

const StoredWineSchema = z.object({}).passthrough();

export type StoredScanWine = {
  id: string; scan_id: string; batch_index: number;
  producer: string | null; cuvee: string | null; vintage: number | null;
  wine_type: string | null; region: string | null; grape: string | null;
  price: string | null; fp: any; fp_source: string | null;
  matched_bottle_id: string | null; match_score: number | null;
};

export const loadRecentScan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const { data: scan } = await supabase.from("scans")
      .select("id,status,page_count,batch_count,batches_done,batches_failed,image_paths,created_at,updated_at")
      .eq("user_id", userId)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!scan) return null;
    const { data: wines } = await supabase.from("scan_wines")
      .select("*").eq("scan_id", scan.id);
    return { scan, wines: (wines ?? []) as StoredScanWine[] };
  });

// ---------- Back-compat: single-call scan (deprecated in favor of batch) ----------

export const scanWineList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      images: z.array(ImageSchema).min(1).max(8),
      image_paths: z.array(z.string()).max(8).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");
    const raw = await extractWinesWithRetry(data.images, key);
    const resolved = await resolveAgainstCatalog(raw, context.supabase);
    const matched = resolved.filter((r) => r.fp_source === "catalog").length;
    const estimated = resolved.filter((r) => r.fp_source === "estimated").length;
    const unreadable = resolved.filter((r) => r.fp_source === "unreadable").length;
    let scanId: string | null = null;
    try {
      const { data: inserted } = await context.supabase.from("scan_logs").insert({
        user_id: context.userId,
        n_photos: data.images.length,
        total_wines: resolved.length,
        matched_count: matched, estimated_count: estimated, unreadable_count: unreadable,
        wines: resolved as any, raw_vision: { wines: raw } as any,
        image_paths: data.image_paths ?? [], status: "parsed",
      }).select("id").single();
      scanId = inserted?.id ?? null;
    } catch { /* best-effort */ }
    return {
      scan_id: scanId, wines: resolved,
      stats: { total: resolved.length, matched, estimated, unreadable, n_photos: data.images.length },
    };
  });
