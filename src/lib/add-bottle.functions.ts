import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FpSchema = z.object({
  fresh: z.number(), acid: z.number(), tannin: z.number(), fruit_dark: z.number(),
  ripe: z.number(), oak: z.number(), body: z.number(), savory: z.number(),
});

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

export type ResearchInput = z.infer<typeof Input>;

export type DuplicateMatch = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  vintage: number | null;
  type: string | null;
  score: number;
};

export type ResearchResult = {
  fp: z.infer<typeof FpSchema>;
  ax_sweet: number;
  tasting_note: string;
  duplicates: DuplicateMatch[];
};

// Mirror scan prompt anchors so values land on the same calibrated scale.
const SYS = `You are a wine sommelier with deep knowledge of producers, grapes, regions, and vintages. Return STRICT JSON only (no markdown, no prose).

You will be given one wine. Infer its style fingerprint on this CALIBRATED 0..1 scale, anchored to the catalog. DO NOT default to 0.5 — use the full range.

Axis anchors:
  fresh      0 = flat/heavy/oxidative   0.5 = neutral   1 = racy/vibrant (Chablis, Mosel, Champagne)
  acid       0 = soft/round (warm Grenache, oaked Chardonnay)   0.5 = medium   1 = piercing (Chablis, Nebbiolo, Riesling, Sancerre)
  tannin     0 = none (whites, rosé, sparkling, dessert)   0.3 = silky (Pinot, Beaujolais)   0.6 = firm (Sangiovese, Bordeaux, Rioja)   0.85 = grippy (young Nebbiolo/Barolo/Sforzato, young Cab, Tannat, Aglianico)
  fruit_dark 0 = pure red fruit (Pinot, Nebbiolo, Sangiovese)   0.5 = mixed   1 = pure black fruit (Cab, Syrah, Malbec)
  ripe       0 = tart/underripe   0.5 = balanced (Bordeaux, Burgundy)   1 = jammy (Napa Cab, Amarone, Sforzato)
  oak        0 = none/steel (Sancerre, Chablis-unoaked)   0.5 = subtle (neutral / large old casks)   1 = heavy new oak (Napa Cab reserve, oaked Chardonnay, modern Rioja)
  body       0 = very light (Mosel Kabinett, Beaujolais)   0.5 = medium (Chianti, Sancerre)   1 = full (Barolo, Napa Cab, Amarone)
  savory     0 = pure fruit-forward (Napa Cab, NW Pinot)   0.5 = mixed   1 = very savory/earthy/tar/leather (Barolo, aged Burgundy, N. Rhône, Etna)

Grape exemplars (anchor; adjust for producer/vintage):
  Nebbiolo (Barolo/Barbaresco/Sforzato): tannin 0.85+, savory 0.75+, acid 0.85+, body 0.8+, fruit_dark ~0.4
  Bordeaux blend / Cabernet Sauvignon: tannin 0.6–0.8, savory 0.35–0.55, fruit_dark 0.75+, body 0.7+, oak typically 0.5+
  Merlot-led Bolgheri / Super Tuscan: body 0.7–0.85, tannin 0.55–0.7, fruit_dark 0.75, ripe 0.7, oak 0.55–0.75, savory 0.35–0.5
  Pinot Noir (Burgundy): tannin 0.25–0.4, savory 0.5–0.75, fruit_dark 0.15, body 0.45, acid 0.75
  Syrah / Shiraz: tannin 0.6, savory N.Rhône 0.75 / New World 0.2, fruit_dark 0.85+
  Chardonnay oaked: oak 0.7+, body 0.7+, acid 0.55
  Chardonnay unoaked (Chablis): oak 0.05, body 0.45, acid 0.85, fresh 0.85
  Riesling (Mosel): acid 0.9, fresh 0.95, body 0.3, oak 0
  Sauvignon Blanc (Sancerre): acid 0.85, fresh 0.9, oak 0.05
  Champagne: acid 0.85, fresh 0.95, body 0.4, tannin 0

Rules:
- All values clamped 0..1.
- For white, rosé, and sparkling wines, tannin and fruit_dark MUST be 0. For dessert wines: white dessert (Sauternes, Tokaji, ice wine) tannin 0; fortified reds (Port, Banyuls, Maury) use real tannin values (typically 0.5–0.8).
- ax_sweet 0..1: 0 = bone dry; 0.15 = off-dry; 0.5 = medium-sweet; 1 = dessert/Sauternes/PX.
- tasting_note: ONE concise sentence (max 220 chars) describing aroma, palate, structure — written like a sommelier note, not marketing copy.

Output shape:
{ "fp": { "fresh":0,"acid":0,"tannin":0,"fruit_dark":0,"ripe":0,"oak":0,"body":0,"savory":0 },
  "ax_sweet": 0,
  "tasting_note": "..." }`;

function clamp01(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

const STOPWORDS = new Set([
  "the","a","an","de","di","du","del","della","el","la","le","les","y","e","and","of",
  "vin","vino","wine","cuvee","cuvée","reserve","reserva","riserva","estate","vineyards",
  "vineyard","winery","cellars","domaine","château","chateau","tenuta","azienda","agricola",
  "weingut","bodega","bodegas","selection","label","bottling","rosso","bianco","blanc","rouge",
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

export const researchBottle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<ResearchResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    // --- Duplicate check first (cheap) ---
    const { supabase } = context;
    const q = [data.producer, data.name].join(" ").trim();
    const { data: cands } = await supabase.rpc("search_bottles_fuzzy", {
      q, type_variants: [data.type], lim: 8, threshold: 0.3,
    });
    const sProd = tok(data.producer);
    const sName = tok(data.name);
    const duplicates: DuplicateMatch[] = [];
    for (const r of (cands ?? []) as any[]) {
      const bProd = tok(r.producer);
      const bName = tok(r.name);
      const prodOv = sProd.filter((t) => bProd.includes(t) || bName.includes(t)).length;
      const nameOv = sName.filter((t) => bName.includes(t) || bProd.includes(t)).length;
      if (prodOv < 1 || nameOv < Math.max(1, Math.ceil(sName.length / 2))) continue;
      const score = Math.min(1, 0.6
        + 0.25 * Math.min(1, prodOv / Math.max(1, sProd.length))
        + 0.15 * (nameOv / Math.max(1, sName.length)));
      duplicates.push({
        id: r.id, name: r.name, producer: r.producer, region: r.region,
        vintage: r.vintage, type: r.type, score,
      });
    }
    duplicates.sort((a, b) => b.score - a.score);

    // --- LLM research ---
    const userMsg = JSON.stringify({
      producer: data.producer,
      cuvee: data.name,
      type: data.type,
      region: data.region ?? null,
      country: data.country ?? null,
      grape: data.grape ?? null,
      vintage: data.vintage ?? null,
    });

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYS },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Rate limited — try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted on this workspace.");
      throw new Error(`Research failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const j = await res.json();
    const content: string = j?.choices?.[0]?.message?.content ?? "";
    let parsed: any;
    try { parsed = JSON.parse(content); }
    catch {
      const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleaned);
    }

    const fp = {
      fresh: clamp01(parsed?.fp?.fresh),
      acid: clamp01(parsed?.fp?.acid),
      tannin: clamp01(parsed?.fp?.tannin),
      fruit_dark: clamp01(parsed?.fp?.fruit_dark),
      ripe: clamp01(parsed?.fp?.ripe),
      oak: clamp01(parsed?.fp?.oak),
      body: clamp01(parsed?.fp?.body),
      savory: clamp01(parsed?.fp?.savory),
    };
    // Enforce non-red rule
    if (data.type !== "red") {
      fp.tannin = 0;
      fp.fruit_dark = 0;
    }
    const ax_sweet = clamp01(parsed?.ax_sweet ?? 0);
    const tasting_note: string = String(parsed?.tasting_note ?? "").slice(0, 400);

    return { fp, ax_sweet, tasting_note, duplicates };
  });

const NoteInput = z.object({
  bottle_id: z.string().uuid(),
  tasting_note: z.string().max(1000),
});

export const updateTastingNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => NoteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("bottles")
      .update({ tasting_note: data.tasting_note, source: "user-added; user tasting note" })
      .eq("id", data.bottle_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
