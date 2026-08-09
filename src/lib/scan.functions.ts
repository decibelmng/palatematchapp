import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cuveeKey } from "@/lib/price-verdict";
import { detectCurrencyFromText } from "@/lib/currency";

// ---------- Price + format parsing helpers ----------

/** Extract numeric price. Handles "$120", "45,00", "€45", and "14 / 52"
 *  (returns the larger — bottle — number when a glass/bottle pair is
 *  present). Returns null when nothing parses. */
export function parsePriceAmount(s: string | null | undefined): number | null {
  if (!s) return null;
  const nums: number[] = [];
  const re = /(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d{1,2})?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(s)))) {
    const raw = m[1];
    const clean = /,\d{1,2}$/.test(raw) ? raw.replace(",", ".") : raw.replace(/[.,](?=\d{3}\b)/g, "");
    const n = Number(clean);
    if (Number.isFinite(n) && n > 0) nums.push(n);
  }
  if (nums.length === 0) return null;
  // Glass / bottle pattern: pick the bottle (larger) number.
  if (nums.length >= 2 && nums[1] > nums[0] && nums[1] / nums[0] >= 2 && nums[1] / nums[0] <= 8) {
    return nums[1];
  }
  return nums[0];
}


/** Infer bottle/glass/half from OCR line cues. Defaults to bottle. */
export function inferFormat(raw: string | null | undefined): "bottle" | "glass" | "half" {
  const s = (raw ?? "").toLowerCase();
  if (/\bhalf\b|\b375\s?ml\b/.test(s)) return "half";
  if (/\bgl\b|\bglass\b|\bby[- ]the[- ]glass\b|\bbtg\b/.test(s)) return "glass";
  return "bottle";
}

/** Best-effort composed "raw line" from parsed fields; preserved for later re-resolution. */
export function composeRawLine(w: {
  producer?: string | null; wine_name?: string | null; vintage?: number | null; price?: string | null;
}): string {
  return [w.producer, w.wine_name, w.vintage, w.price].filter(Boolean).join(" ").trim();
}


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
  /** Present when the row came from persisted scan_wines — lets a rating link
   *  back to the exact scan line it was made from. */
  scan_wine_id?: string | null;
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
export type MatchVerdict = {
  score: number;
  reasons: string[];
  /** true only when the scanned vintage and the catalog row's vintage agree. */
  vintageExact: boolean;
  /** Years apart when both vintages are known and differ; null otherwise. */
  vintageGap: number | null;
};

const NO_MATCH: MatchVerdict = { score: 0, reasons: [], vintageExact: false, vintageGap: null };

/**
 * Vintage participates in scoring. It used to be accepted and ignored, which
 * let a 2022 list line resolve to a 2008 catalog row purely on trigram luck —
 * an accurate per-vintage fingerprint is worthless if the matcher then picks an
 * arbitrary vintage.
 */
function scoreMatch(
  scanned: ScannedWine,
  bottle: { name: string; producer: string | null; type: string | null; vintage: number | null },
): MatchVerdict {
  if (!typeMatches(scanned.type, bottle.type)) {
    return { ...NO_MATCH, reasons: [`type mismatch (${scanned.type ?? "red"} vs ${bottle.type ?? "red"})`] };
  }
  const sProd = tokens(scanned.producer);
  const sName = tokens(scanned.wine_name);
  const bProd = tokens(bottle.producer);
  const bName = tokens(bottle.name);
  const prodOverlap = sProd.filter((t) => bProd.includes(t) || bName.includes(t)).length;
  const nameOverlap = sName.filter((t) => bName.includes(t) || bProd.includes(t)).length;
  const haveProd = sProd.length > 0;
  const needNameMatch = Math.max(1, Math.ceil(sName.length / 2));
  if (haveProd && prodOverlap < 1) return { ...NO_MATCH, reasons: ["producer: no shared word"] };
  if (!haveProd && (sName.length + prodOverlap) < 2) return { ...NO_MATCH, reasons: ["too little name evidence"] };
  if (sName.length > 0 && nameOverlap < needNameMatch) {
    return { ...NO_MATCH, reasons: [`name: ${nameOverlap}/${sName.length} words, needed ${needNameMatch}`] };
  }
  const prodScore = haveProd ? Math.min(1, prodOverlap / Math.max(1, sProd.length)) : 0.5;
  const nameScore = sName.length > 0 ? nameOverlap / sName.length : 0.5;

  const reasons: string[] = [
    `producer ${prodOverlap}/${Math.max(1, sProd.length)} (${prodScore.toFixed(2)})`,
    `name ${nameOverlap}/${Math.max(1, sName.length)} (${nameScore.toFixed(2)})`,
  ];

  let vintageTerm = 0;
  let vintageExact = false;
  let vintageGap: number | null = null;
  const sv = scanned.vintage ?? null;
  const bv = bottle.vintage ?? null;
  if (sv != null && bv != null) {
    if (sv === bv) {
      vintageExact = true;
      vintageTerm = 0.12;
      reasons.push(`vintage exact ${sv} (+0.12)`);
    } else {
      vintageGap = Math.abs(sv - bv);
      // One year apart is a near-miss; fifteen is a different wine.
      vintageTerm = -Math.min(0.35, 0.035 * vintageGap);
      reasons.push(`vintage ${sv} vs ${bv}, ${vintageGap}y apart (${vintageTerm.toFixed(2)})`);
    }
  } else {
    reasons.push(sv == null ? "vintage not read on list" : "catalog row has no vintage");
  }

  const score = Math.max(0.05, Math.min(1, 0.6 + 0.25 * prodScore + 0.15 * nameScore + vintageTerm));
  reasons.push(`score ${score.toFixed(3)}`);
  return { score, reasons, vintageExact, vintageGap };
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

/**
 * Per-attempt deadlines. A severed gateway request used to hang the whole
 * screen forever (http 499 at 23s, handler never returned), so nothing here is
 * allowed to wait indefinitely.
 *
 * FIRST_ATTEMPT_MS (60s) comfortably exceeds the slowest scan we have observed
 * end to end (45s, 2026-08-09 01:01). RETRY_MS is shorter because a retry only
 * happens after we already burned that budget — worst case server-side is
 * 60 + 45 = 105s, which is what the client deadline is sized against.
 */
export const VISION_FIRST_ATTEMPT_MS = 60_000;
export const VISION_RETRY_MS = 45_000;

async function callVision(
  images: z.infer<typeof ImageSchema>[],
  apiKey: string,
  timeoutMs: number,
) {
  const imageBlocks = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.media_type};base64,${img.image_base64}` },
  }));
  const intro = images.length > 1
    ? `${PROMPT}\n\nNOTE: ${images.length} photos of the SAME wine list (multiple pages). Combine into ONE array; deduplicate.`
    : PROMPT;
  let res: Response;
  try {
    res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": apiKey },
      // No timeout here at all was the hang: an aborted request now surfaces
      // as a thrown error the handler can record as a failed batch.
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        max_tokens: 8000,
        messages: [{ role: "user", content: [{ type: "text", text: intro }, ...imageBlocks] }],
        response_format: { type: "json_object" },
      }),
    });
  } catch (e) {
    const name = (e as Error)?.name ?? "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new VisionTimeout(`Reading timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw e;
  }
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

/** Timed-out or severed gateway call — the only class of failure we retry. */
class VisionTimeout extends Error {
  readonly isTimeout = true;
}

async function extractWinesWithRetry(images: z.infer<typeof ImageSchema>[], apiKey: string): Promise<ScannedWine[]> {
  const attempt = async (imgs: z.infer<typeof ImageSchema>[], timeoutMs: number) => {
    const { content, finishReason } = await callVision(imgs, apiKey, timeoutMs);
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
    return await attempt(images, VISION_FIRST_ATTEMPT_MS);
  } catch (e) {
    // Truncated? If we sent >1 image, split into single-page calls and merge.
    if (images.length > 1) {
      const parts = await Promise.all(images.map((img) => attempt([img], VISION_RETRY_MS)));
      return parts.flat();
    }
    // A timeout is the one failure worth re-sending: nothing has been written
    // yet at this point in the handler, so a retry cannot duplicate wines.
    if ((e as VisionTimeout)?.isTimeout) {
      return await attempt(images, VISION_RETRY_MS);
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
    let best: { row: any; verdict: MatchVerdict } | null = null;
    let runnerUpNote: string | null = null;
    if (q.length >= 3) {
      // The scanned vintage now reaches retrieval, so the exact-vintage row is
      // in the candidate set instead of depending on trigram luck.
      const { data: candidates } = await supabase.rpc("search_bottles_fuzzy", {
        q, type_variants: w.type ? [w.type as string] : undefined, lim: 8, threshold: 0.25,
        v_vintage: w.vintage ?? null,
      });
      for (const row of (candidates ?? []) as any[]) {
        const v = scoreMatch(w, row);
        if (v.score > 0 && (!best || v.score > best.verdict.score)) best = { row, verdict: v };
      }
      if (best && !best.verdict.vintageExact && w.vintage != null) {
        runnerUpNote = `no ${w.vintage} row in catalog — closest vintage we have`;
      }
    }
    if (best) {
      const r = best.row;
      const reasons = [
        `q="${q}"`,
        ...best.verdict.reasons,
        ...(runnerUpNote ? [runnerUpNote] : []),
        ...(best.verdict.vintageGap != null ? ["flag:vintage_approx"] : []),
      ];
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
        match_score: best.verdict.score,
        match_reasons: reasons,
        vintage_approx: best.verdict.vintageGap != null,
      };
    }
    return {
      ...w, fp_resolved: w.fp, fp_source: "estimated",
      matched_bottle_id: null, matched_bottle_name: null, match_score: 0,
      match_reasons: [`q="${q}"`, "no candidate cleared the matcher"],
    };
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
    venue_raw_text: z.string().max(200).nullable().optional(),
    // Deliberately loose: an unparseable value is dropped below rather than
    // rejected. Attribution is optional and must never fail the scan.
    restaurant_id: z.string().nullable().optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Optional attribution never participates in the required write path.
    // Anything that isn't a real restaurants.id is dropped; the user can
    // attribute after the results render.
    let restaurantId: string | null = null;
    const candidate = data.restaurant_id?.trim() || null;
    if (candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)) {
      try {
        const { data: venue } = await supabase
          .from("restaurants").select("id").eq("id", candidate).maybeSingle();
        if (venue?.id) restaurantId = venue.id as string;
      } catch {
        restaurantId = null;
      }
    }

    const { data: inserted, error } = await supabase.from("scans").insert({
      user_id: userId,
      status: "processing",
      page_count: data.page_count,
      batch_count: data.batch_count,
      image_paths: data.image_paths ?? [],
      venue_raw_text: data.venue_raw_text?.trim() || null,
      restaurant_id: restaurantId,
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

    // IDEMPOTENCY GUARD. A client retry (or a re-sent request whose first
    // response was lost in flight) must never write the same wines twice or
    // pay for a second vision call. This batch index is already known, so if
    // rows exist for it the work landed: re-assert mark_scan_batch_done (it is
    // itself idempotent) and hand back what is already stored.
    {
      const { data: existing } = await supabase
        .from("scan_wines").select("*")
        .eq("scan_id", data.scan_id).eq("batch_index", data.batch_index);
      if (existing && existing.length > 0) {
        const { rowToResolved } = await import("@/lib/scan-helpers");
        await supabase.rpc("mark_scan_batch_done", { p_scan_id: data.scan_id, p_batch_index: data.batch_index });
        return {
          batch_index: data.batch_index,
          wines: existing.map((r: any) => ({ ...rowToResolved(r), scan_wine_id: r.id as string })),
        };
      }
    }

    try {
      const raw = await extractWinesWithRetry(data.images, key);
      const resolved = await resolveAgainstCatalog(raw, supabase);

      // Persist immediately with raw_text/format/price_amount captured for
      // later re-resolution and silent price capture.
      if (resolved.length > 0) {
        const rows = resolved.map((w) => {
          const rawLine = composeRawLine(w);
          return {
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
            price_amount: parsePriceAmount(w.price ?? null),
            currency: detectCurrencyFromText(w.price ?? rawLine) ?? "USD",
            format: inferFormat(rawLine),
            raw_text: rawLine || null,
            raw_json: w as any,
            fp: (w.fp_resolved ?? null) as any,
            fp_source: w.fp_source,
            matched_bottle_id: w.matched_bottle_id,
            match_score: w.match_score,
            match_reasons: (w.match_reasons ?? []) as any,
          };
        });
        // Return the line ids to the client so a rating made on a LIVE scan
        // logs which row it came from, not just the scan and the rank.
        // PostgREST returns inserted rows in insert order; if the count ever
        // disagrees we attach nothing rather than pair ids to the wrong wine.
        const { data: insertedRows } = await supabase
          .from("scan_wines").insert(rows).select("id");
        if (insertedRows && insertedRows.length === resolved.length) {
          resolved.forEach((w, i) => { w.scan_wine_id = (insertedRows[i] as any).id as string; });
        }
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
    const { finalizeScanCore } = await import("@/lib/scan-finalize.server");
    return finalizeScanCore(context.supabase as any, context.userId, data.scan_id);
  });

/**
 * Reconcile-on-read. Called when a scan is opened: if it is still "processing"
 * but every batch landed, finalize runs now. Covers the common case (the user
 * comes back to the app) without waiting for the scheduled sweep.
 */
export const reconcileScanIfStuck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ scan_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { reconcileOne } = await import("@/lib/scan-finalize.server");
    return reconcileOne(context.supabase as any, context.userId, data.scan_id);
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
