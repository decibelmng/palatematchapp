import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const WineType = z.enum(["red", "white", "sparkling", "rose", "dessert"]);

const Extracted = z.object({
  producer: z.string().nullable().optional(),
  wine_name: z.string().nullable().optional(),
  vintage: z.number().int().nullable().optional(),
  region: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  grape: z.string().nullable().optional(),
  type: WineType.nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).nullable().optional(),
  looks_like_menu: z.boolean().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type BottleExtract = z.infer<typeof Extracted>;

export type BottleCandidate = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  vintage: number | null;
  type: string | null;
  score: number;
  reasons: string[];
  fp: {
    fresh: number; acid: number; tannin: number; fruit_dark: number;
    ripe: number; oak: number; body: number; savory: number;
  };
  tasting_note: string | null;
};

export type BottleScanResult = {
  scan_id: string | null;
  extracted: BottleExtract;
  candidates: BottleCandidate[];
  best_score: number;
  match_quality: "confident" | "ambiguous" | "none";
  match_summary: string;
  image_paths: string[];
  looks_like_menu: boolean;
};


const PROMPT = `You are reading photo(s) of a wine bottle LABEL (front, sometimes back). Return ONLY strict JSON — no prose, no markdown.

Extract exactly ONE wine and INFER what the label doesn't literally say, using wine knowledge:
  producer   — the winery / estate / domaine / château (e.g. "Château Margaux", "Silver Oak", "Produttori del Barbaresco")
  wine_name  — the cuvée or single-vineyard name on the label if any (e.g. "Hillside Select", "Le Colonne"). NULL if the label is just producer + region/appellation (many classic European wines).
  vintage    — 4-digit year on the label, or null
  region     — appellation / region as printed OR clearly implied (e.g. "Barolo DOCG" → region "Barolo, Piemonte"; "Margaux" → "Margaux, Bordeaux")
  country    — infer from the appellation ("Barolo" → "Italy"; "Margaux" → "France"; "Napa Valley" → "USA")
  grape      — INFER from the appellation when not stated ("Barolo"/"Barbaresco" → "Nebbiolo"; "Chablis" → "Chardonnay"; "Sancerre" → "Sauvignon Blanc"; "Chianti" → "Sangiovese"; "Rioja" red → "Tempranillo"; "Champagne" → "Chardonnay, Pinot Noir, Meunier"). Leave null only if you truly cannot infer.
  type       — "red" | "white" | "sparkling" | "rose" | "dessert" — infer from grape/appellation ("Margaux" → red; "Sancerre" → white; "Champagne" → sparkling; "Sauternes" → dessert)
  confidence — "high" if the label is crisp and you're sure; "medium" if some fields are inferred; "low" if the photo is bad or the wine is obscure

Also set:
  looks_like_menu — true if the photo(s) show a printed wine list / menu / multiple bottles / a page of text rather than one bottle label. Otherwise false.
  notes — short (<=200 char) free text if there's anything unusual worth flagging (e.g. "back label lists 60% Merlot, 40% Cab Franc"), else null

Rules:
- Output ONE wine object, not an array.
- Do NOT hallucinate a wine_name if the label doesn't have one — leave it null. Producer + appellation is a valid identification for classic wines.
- Use the appellation to fill grape/type/country/region even when not printed.

Output shape:
{ "producer": "...", "wine_name": "..." | null, "vintage": 2019 | null, "region": "...", "country": "...", "grape": "...", "type": "red", "confidence": "high", "looks_like_menu": false, "notes": null }`;

const ImageSchema = z.object({
  image_base64: z.string().min(100),
  media_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic"]),
});

// -- Matching helpers (mirror the scan-list scoring) --

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
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tok(s: string | null | undefined): string[] {
  return norm(s).split(" ").filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function scoreWithReasons(
  e: BottleExtract,
  b: { name: string; producer: string | null; type: string | null; region: string | null; vintage: number | null },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (e.type && b.type && e.type !== b.type) {
    return { score: 0, reasons: [`Type mismatch (label ${e.type} vs catalog ${b.type})`] };
  }
  const sProd = tok(e.producer);
  const sName = tok(e.wine_name);
  const sReg  = tok(e.region);
  const bProd = tok(b.producer);
  const bName = tok(b.name);
  const bReg  = tok(b.region);

  const prodMatched = sProd.filter((t) => bProd.includes(t) || bName.includes(t));
  const nameMatched = sName.filter((t) => bName.includes(t) || bProd.includes(t));
  const regMatched  = sReg.filter((t) => bReg.includes(t) || bName.includes(t));

  const prodOv = prodMatched.length;
  const nameOv = nameMatched.length;
  const regOv  = regMatched.length;

  const haveProd = sProd.length > 0;
  const needName = Math.max(1, Math.ceil(sName.length / 2));
  if (haveProd && prodOv < 1) {
    return { score: 0, reasons: [`Producer "${e.producer}" doesn't overlap with "${b.producer ?? b.name}"`] };
  }
  if (!haveProd && (sName.length + prodOv) < 2) {
    return { score: 0, reasons: ["Not enough label words to match confidently"] };
  }
  if (sName.length > 0 && nameOv < needName) {
    return { score: 0, reasons: [`Cuvée name "${e.wine_name}" only partially overlaps`] };
  }

  const prodScore = haveProd ? Math.min(1, prodOv / Math.max(1, sProd.length)) : 0.5;
  const nameScore = sName.length > 0 ? nameOv / sName.length : 0.5;
  const regBonus  = sReg.length > 0 && regOv > 0 ? 0.05 : 0;
  const score = Math.min(1, 0.6 + 0.25 * prodScore + 0.15 * nameScore + regBonus);

  if (e.type && b.type && e.type === b.type) reasons.push(`Same type (${e.type})`);
  if (prodMatched.length) {
    const pct = Math.round((prodOv / Math.max(1, sProd.length)) * 100);
    reasons.push(`Producer overlap ${pct}% — matched "${prodMatched.join(", ")}"`);
  }
  if (nameMatched.length) {
    reasons.push(`Cuvée words matched: "${nameMatched.join(", ")}"`);
  } else if (sName.length === 0) {
    reasons.push("Label had no cuvée name — matched on producer + region");
  }
  if (regMatched.length) {
    reasons.push(`Region overlap on "${regMatched.join(", ")}"`);
  } else if (sReg.length > 0 && b.region) {
    reasons.push(`Region on label ("${e.region}") didn't align with catalog region ("${b.region}")`);
  }
  if (e.vintage && b.vintage) {
    reasons.push(
      e.vintage === b.vintage
        ? `Same vintage ${e.vintage}`
        : `Different vintage (label ${e.vintage}, catalog ${b.vintage}) — same cuvée`,
    );
  }
  return { score, reasons };
}


export const scanBottleLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      images: z.array(ImageSchema).min(1).max(2),
      image_paths: z.array(z.string()).max(2).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<BottleScanResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const imageBlocks = data.images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: `data:${img.media_type};base64,${img.image_base64}` },
    }));
    const intro = data.images.length > 1
      ? `${PROMPT}\n\nNOTE: ${data.images.length} photos of the SAME bottle (e.g. front + back label). Merge into ONE object.`
      : PROMPT;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
    let parsed: unknown;
    try { parsed = JSON.parse(content); }
    catch {
      const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleaned);
    }
    const p = Extracted.safeParse(parsed);
    if (!p.success) throw new Error("Vision returned an unexpected shape.");
    const extracted = p.data;
    const looks_like_menu = !!extracted.looks_like_menu;

    // ---------- Catalog match ----------
    const { supabase, userId } = context;
    let candidates: BottleCandidate[] = [];
    let bestScore = 0;
    if (!looks_like_menu) {
      const q = [extracted.producer, extracted.wine_name, extracted.region]
        .filter(Boolean).join(" ").trim();
      if (q.length >= 3) {
        const { data: rows } = await supabase.rpc("search_bottles_fuzzy", {
          q,
          type_variants: extracted.type ? [extracted.type as string] : undefined,
          lim: 12,
          threshold: 0.22,
        });
        const scored = ((rows ?? []) as any[])
          .map((r) => ({ r, s: score(extracted, r) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 3);
        candidates = scored.map(({ r, s }) => ({
          id: r.id,
          name: r.name,
          producer: r.producer,
          region: r.region,
          vintage: r.vintage,
          type: r.type,
          score: s,
          fp: {
            fresh: r.fp_fresh, acid: r.fp_acid, tannin: r.fp_tannin,
            fruit_dark: r.fp_fruit_dark, ripe: r.fp_ripe, oak: r.fp_oak,
            body: r.fp_body, savory: r.fp_savory,
          },
          tasting_note: r.tasting_note ?? null,
        }));
        bestScore = candidates[0]?.score ?? 0;
      }
    }

    const match_quality: BottleScanResult["match_quality"] =
      bestScore >= 0.85 ? "confident" : bestScore >= 0.6 ? "ambiguous" : "none";

    // ---------- Persist scan log ----------
    let scanId: string | null = null;
    try {
      const { data: inserted } = await supabase.from("scan_logs").insert({
        user_id: userId,
        n_photos: data.images.length,
        total_wines: candidates.length > 0 ? 1 : 0,
        matched_count: match_quality === "confident" ? 1 : 0,
        estimated_count: 0,
        unreadable_count: extracted.confidence === "low" ? 1 : 0,
        wines: [{ kind: "bottle", extracted, candidates, match_quality }] as any,
        raw_vision: { kind: "bottle", extracted } as any,
        image_paths: data.image_paths ?? [],
        status: "parsed",
      }).select("id").single();
      scanId = inserted?.id ?? null;
    } catch { /* logging must not break UX */ }

    return {
      scan_id: scanId,
      extracted,
      candidates,
      best_score: bestScore,
      match_quality,
      image_paths: data.image_paths ?? [],
      looks_like_menu,
    };
  });
