// Shared calibrated fingerprint system prompt + gateway helper.
// Single source of truth for both new-bottle research and cuvée re-fingerprinting.

export const FINGERPRINT_SYS = `You are a wine sommelier with deep knowledge of producers, grapes, regions, and vintages. Return STRICT JSON only (no markdown, no prose).

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
  Chardonnay oaked (Napa reserve, Meursault, old-guard Langhe like Gaja Gaia&Rey / Pio Cesare Piodilei): oak 0.7+, body 0.7+, acid 0.55
  Chardonnay unoaked/steely (Chablis, Alta Langa, modern small-producer Langhe like Rossj-Bass): oak 0.05-0.2, body 0.45-0.55, acid 0.75-0.85, fresh 0.75-0.85

CRITICAL — grape×region priors do NOT override producer/cuvée style.
Regions like Langhe/Piedmont Chardonnay, Bourgogne Blanc, and California
Chardonnay are BIMODAL (barrique school AND stainless school coexist).
Do not auto-apply barrique/oak to every wine from these regions. If the
specific cuvée is unknown, weight AGAINST barrique for entry-tier and small
producer bottlings; weight TOWARD barrique only for named single-vineyard
reserves that clearly signal it. Same rule for Sauvignon Blanc (Sancerre
crisp vs. Fumé/Graves oaked), Chenin (steely Vouvray vs. rich Savennières).
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

export type FpValues = {
  fresh: number; acid: number; tannin: number; fruit_dark: number;
  ripe: number; oak: number; body: number; savory: number;
};

export function clamp01(n: unknown): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

export type FingerprintInput = {
  producer: string;
  name: string;
  type: string;
  region?: string | null;
  country?: string | null;
  grape?: string | null;
  vintage?: number | null;
};

export type FingerprintResult = {
  fp: FpValues;
  ax_sweet: number;
  tasting_note: string;
};

export async function callFingerprintGateway(
  input: FingerprintInput,
  apiKey: string,
): Promise<FingerprintResult> {
  const userMsg = JSON.stringify({
    producer: input.producer,
    cuvee: input.name,
    type: input.type,
    region: input.region ?? null,
    country: input.country ?? null,
    grape: input.grape ?? null,
    vintage: input.vintage ?? null,
  });

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: FINGERPRINT_SYS },
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Rate limited — try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted on this workspace.");
    throw new Error(`Fingerprint failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const j = await res.json();
  const content: string = j?.choices?.[0]?.message?.content ?? "";
  let parsed: any;
  try { parsed = JSON.parse(content); }
  catch {
    const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    parsed = JSON.parse(cleaned);
  }

  const fp: FpValues = {
    fresh: clamp01(parsed?.fp?.fresh),
    acid: clamp01(parsed?.fp?.acid),
    tannin: clamp01(parsed?.fp?.tannin),
    fruit_dark: clamp01(parsed?.fp?.fruit_dark),
    ripe: clamp01(parsed?.fp?.ripe),
    oak: clamp01(parsed?.fp?.oak),
    body: clamp01(parsed?.fp?.body),
    savory: clamp01(parsed?.fp?.savory),
  };
  if (input.type !== "red" && input.type !== "dessert") {
    fp.tannin = 0;
    fp.fruit_dark = 0;
  }
  const ax_sweet = clamp01(parsed?.ax_sweet ?? 0);
  const tasting_note: string = String(parsed?.tasting_note ?? "").slice(0, 400);

  return { fp, ax_sweet, tasting_note };
}
