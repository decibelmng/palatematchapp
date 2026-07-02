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
  match_score: number; // 0..1 explainer
};

/** Calibrated fingerprint prompt — same scale as the catalog's fp_ columns.
 *  Anchored definitions + grape exemplars force the model off the 0.5 default. */
const PROMPT = `You are reading a photo of a restaurant wine list. Return ONLY valid JSON — no prose, no markdown fences. Read EVERY wine visible on the list.

For each wine, output an object with:
  producer, wine_name, vintage (int or null), region, grape, price (string or null)
  type: "red" | "white" | "sparkling" | "rose" | "dessert" — classify each wine. Champagne / Prosecco / Cava / Crémant / Franciacorta / Sekt / Lambrusco => sparkling. Rosé / rosado / rosato => rose. Sauternes / Tokaji / late-harvest / icewine / PX / Vin Santo => dessert. Otherwise red or white based on grape.
  fp: eight CALIBRATED style values, each a float 0..1, inferred from your knowledge of that producer/grape/region/vintage. DO NOT default to 0.5 — use the FULL 0..1 range. 0.5 means "textbook medium"; most wines are NOT textbook medium on every axis.

  Anchored axis definitions (calibrated to the catalog scale):
    fresh      0 = flat, heavy, tiring (oxidative, hot-climate)   0.5 = neutral   1 = racy, high-lift, vibrant (Chablis, Mosel Riesling, Champagne)
    acid       0 = soft/round/low (warm-climate Grenache, oaked Chardonnay)   0.5 = medium   1 = piercing (Chablis, Nebbiolo, Riesling, Sancerre)
    tannin     0 = none (all whites, rosé, sparkling, dessert)   0.3 = silky (Pinot Noir, Beaujolais)   0.6 = firm (Sangiovese, Bordeaux blend, Rioja)   0.85 = grippy (young Nebbiolo/Barolo/Barbaresco/Sforzato, young Cabernet, Tannat, Aglianico)
    fruit_dark 0 = pure red fruit (cherry, raspberry — Pinot, Nebbiolo, Sangiovese)   0.5 = mixed   1 = pure black fruit (cassis, blackberry, plum — Cab, Syrah, Malbec)
    ripe       0 = tart/lean/underripe (cool-climate, high-acid)   0.5 = balanced (classic Bordeaux, Burgundy)   1 = jammy/overripe (Napa Cab, Aussie Shiraz, Amarone, Sforzato)
    oak        0 = none/steel (Sancerre, Chablis-unoaked, most rosé/sparkling)   0.5 = subtle (neutral oak, large old casks)   1 = heavy new oak (vanilla, toast, mocha — Napa Cab reserve, oaked Chardonnay, modern Rioja)
    body       0 = very light (Mosel Kabinett, Beaujolais)   0.5 = medium (Chianti, Sancerre)   1 = full/powerful (Barolo, Napa Cab, Amarone, Sforzato)
    savory     0 = pure fruit-forward (Napa Cab, New World Pinot)   0.5 = mixed   1 = very savory/earthy (truffle, leather, tar, balsamic — Barolo, aged Burgundy, Northern Rhône, Sforzato, Etna)

  Grape exemplars — use these to anchor (don't blindly copy; adjust for producer/vintage):
    Nebbiolo (Barolo/Barbaresco/Sforzato/Valtellina): tannin 0.85+, savory 0.75+, acid 0.85+, body 0.8+, fruit_dark 0.4 (red fruit), ripe varies (Sforzato/Amarone-style → 0.85; classic Barolo → 0.55)
    Bordeaux blend / Cabernet Sauvignon: tannin 0.6–0.8, savory 0.35–0.55, fruit_dark 0.75+, body 0.7+, oak typically 0.5+ for serious wines
    Pinot Noir (Burgundy): tannin 0.25–0.4, savory 0.5–0.75, fruit_dark 0.15, body 0.4–0.55, acid 0.7+
    Syrah / Shiraz: tannin 0.6, savory N. Rhône 0.75 / New World 0.2, fruit_dark 0.85+, ripe varies
    Chardonnay oaked (Meursault, Napa): oak 0.7+, body 0.7+, acid 0.55, fresh 0.45
    Chardonnay unoaked (Chablis): oak 0.05, body 0.45, acid 0.85, fresh 0.85
    Riesling (Mosel): acid 0.9, fresh 0.95, body 0.3, oak 0
    Sauvignon Blanc (Sancerre/Marlborough): acid 0.85, fresh 0.9, oak 0.05, body 0.35
    Champagne: acid 0.85, fresh 0.95, body 0.4, tannin 0, oak 0.1–0.3 (vintage/Krug higher)

  confidence: "high" | "medium" | "low" — how sure you are of this fp inference for this specific wine.

Rules:
- Include every wine, even if you must guess. If a line is illegible, omit it.
- For unknown obscure producers, infer fp from the grape/region exemplars above — that is more accurate than defaulting to 0.5.
- For non-reds, tannin and fruit_dark must be ~0.
- Do NOT invent wines that aren't on the list.
- Output shape: { "wines": [ { ... }, ... ] }`;

const ImageSchema = z.object({
  image_base64: z.string().min(100),
  media_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic"]),
});

// ---------- Matching helpers ----------

const STOPWORDS = new Set([
  "the", "a", "an", "de", "di", "du", "del", "della", "el", "la", "le", "les",
  "y", "e", "and", "of", "vin", "vino", "wine", "cuvee", "cuvée", "reserve",
  "reserva", "riserva", "estate", "vineyards", "vineyard", "winery", "cellars",
  "domaine", "château", "chateau", "ch.", "tenuta", "azienda", "agricola",
  "weingut", "bodega", "bodegas", "selection", "label", "bottling", "rosso",
  "bianco", "blanc", "rouge", "rose", "rosato", "rosado", "red", "white",
]);

function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string | null | undefined): string[] {
  return normalize(s).split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function typeMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = (a ?? "red").toLowerCase();
  const nb = (b ?? "red").toLowerCase();
  return na === nb;
}

/** Confidence rule:
 *   producer tokens overlap >= 1 (or producer empty AND name overlap >= 2)
 *   AND name tokens overlap >= max(1, ceil(scanned_name_tokens / 2))
 *   AND same type
 *   Vintage match adds bonus (not required).
 *   Returns 0 if not confident; otherwise 0.55..1.0 score. */
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

  // Score: producer weight + name overlap ratio. Vintage is intentionally
  // NOT a match factor — cuvée-level style matching is what we want.
  const prodScore = haveProd ? Math.min(1, prodOverlap / Math.max(1, sProd.length)) : 0.5;
  const nameScore = sName.length > 0 ? nameOverlap / sName.length : 0.5;

  return Math.min(1, 0.6 + 0.25 * prodScore + 0.15 * nameScore);
}

// ---------- Server fn ----------

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

    const imageBlocks = data.images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: `data:${img.media_type};base64,${img.image_base64}` },
    }));

    const intro = data.images.length > 1
      ? `${PROMPT}\n\nNOTE: ${data.images.length} photos of the SAME wine list (multiple pages). Combine all wines into ONE output array. Deduplicate any wine that appears on more than one page.`
      : PROMPT;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{
          role: "user",
          content: [{ type: "text", text: intro }, ...imageBlocks],
        }],
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
    let parsed: unknown;
    try { parsed = JSON.parse(content); }
    catch {
      const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleaned);
    }

    const shape = z.object({ wines: z.array(WineSchema) }).safeParse(parsed);
    if (!shape.success) throw new Error("Vision returned an unexpected shape.");
    const rawWines = shape.data.wines;

    // ---------- Catalog matching ----------
    const { supabase, userId } = context;
    const resolved: ResolvedWine[] = await Promise.all(
      rawWines.map(async (w): Promise<ResolvedWine> => {
        if (!w.fp) {
          return {
            ...w,
            fp_resolved: null,
            fp_source: "unreadable",
            matched_bottle_id: null,
            matched_bottle_name: null,
            match_score: 0,
          };
        }
        const q = [w.producer, w.wine_name].filter(Boolean).join(" ").trim();
        let best: { row: any; score: number } | null = null;
        if (q.length >= 3) {
          const { data: candidates } = await supabase.rpc("search_bottles_fuzzy", {
            q,
            type_variants: w.type ? [w.type as string] : undefined,
            lim: 8,
            threshold: 0.25,
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
        return {
          ...w,
          fp_resolved: w.fp,
          fp_source: "estimated",
          matched_bottle_id: null,
          matched_bottle_name: null,
          match_score: 0,
        };
      }),
    );

    // ---------- Persist scan log ----------
    const matched = resolved.filter((r) => r.fp_source === "catalog").length;
    const estimated = resolved.filter((r) => r.fp_source === "estimated").length;
    const unreadable = resolved.filter((r) => r.fp_source === "unreadable").length;

    let scanId: string | null = null;
    try {
      const { data: inserted } = await supabase.from("scan_logs").insert({
        user_id: userId,
        n_photos: data.images.length,
        total_wines: resolved.length,
        matched_count: matched,
        estimated_count: estimated,
        unreadable_count: unreadable,
        wines: resolved as any,
        raw_vision: { wines: rawWines } as any,
        image_paths: data.image_paths ?? [],
        status: "parsed",
      }).select("id").single();
      scanId = inserted?.id ?? null;
    } catch {
      // logging failure must not break the user-facing scan
    }

    return {
      scan_id: scanId,
      wines: resolved,
      stats: {
        total: resolved.length,
        matched,
        estimated,
        unreadable,
        n_photos: data.images.length,
      },
    };
  });
