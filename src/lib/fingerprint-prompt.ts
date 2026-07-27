// Blinded two-step fingerprint pipeline (v2 — leak-hardened).
//
// v1 leaked prestige because Step 1 wrote sighted evaluative notes ("powerful,
// commanding, benchmark") that the blind scorer faithfully translated into
// higher tannin/body. v2 fixes this in three ways:
//
//   Step 1 (SIGHTED, DESCRIPTIVE-ONLY) — the model sees producer, cuvée,
//     region, grape, vintage. It writes a purely sensory note. It is
//     explicitly forbidden from evaluating quality, prestige, ageing, or
//     status. A note for a $15 wine must be stylistically indistinguishable
//     from one for a $1,500 wine except in flavour content.
//
//   Step 2 (BLIND, GRAPE-AWARE) — the scorer sees ONLY wine type, grape
//     variety, and the note. Grape is a CALIBRATION anchor (Pinot's "firm"
//     is not Nebbiolo's "firm"). It never sees producer, region, appellation,
//     vintage, price, or any prestige signal.
//
//   Anchors — every axis has explicit range anchors (concrete examples of
//     wines that sit at 0.2, 0.5, 0.8) so the model uses the full range
//     instead of clustering the middle.

const NOTE_SYS = `You are a wine sommelier writing a purely DESCRIPTIVE tasting note (max 220 chars). Return STRICT JSON only, no markdown, no numeric scores.

Output shape: { "tasting_note": "..." }

RULES — read carefully, these are strict:

1. Describe ONLY what the wine tastes like, smells like, and how it feels in the mouth. Aromas, flavors, texture, tannin quality, acidity level, sweetness, oak influence, finish length.

2. DO NOT evaluate quality, prestige, importance, ageing potential, price, or status. Never assess whether the wine is good, serious, benchmark, reference, world-class, legendary, iconic, age-worthy, collectible, important, or noble.

3. BANNED WORDS (do not use, in any form): profound, majestic, commanding, serious, benchmark, reference, legendary, world-class, iconic, age-worthy, ageworthy, important, noble, regal, prestigious, hallowed, revered, storied, historic, cult, grand, grandiose, monumental, towering, imposing, authoritative, complete, complex (as a verdict — you may say "layered" descriptively), profound, sublime, transcendent.

4. Structural words must describe SENSATION, not stature.
   ALLOWED: "firm, drying tannins that grip the finish", "silky texture", "high acidity that cuts through", "generous fruit", "restrained oak".
   FORBIDDEN: "powerful and structured" (verdict), "commanding presence" (verdict), "serious wine" (verdict), "built to age" (verdict).

5. A note for a $15 wine and a $1500 wine from the same appellation must be stylistically INDISTINGUISHABLE except in the flavors and textures actually present. Same length, same register, same vocabulary. If you are tempted to sound reverent, stop.

6. Prefer concrete descriptors: cherry, blackcurrant, iodine, wet stone, orange peel, dried herbs, cedar, leather, sea spray. Avoid abstract nouns of quality (depth, class, poise, gravitas).

Write as if you did not know what wine it was — only what it tasted like.`;

const SCORE_SYS = `You translate a tasting note into a CALIBRATED 0..1 style fingerprint. You are given wine TYPE, GRAPE variety, and the NOTE. You are NOT told the producer, region, appellation, vintage, or price. Do not guess them. Do not import reputation. Score ONLY the sensory content of the note. Return STRICT JSON only.

DO NOT default to 0.5. USE THE FULL 0..1 RANGE. If your first three answers all fall between 0.4 and 0.7, you are compressing — reconsider against the anchors.

Values clamped 0..1.

=== AXIS ANCHORS (calibrated across the real wine world) ===

fp_fresh  (flat/heavy 0 ← → 1 racy/vibrant)
  0.15 oxidative Sherry, tired old wine
  0.35 warm-climate Grenache blends, ripe Zinfandel
  0.55 mainstream New World Chardonnay
  0.75 crisp Sauvignon Blanc, young Riesling
  0.90 Muscadet, high-acid Champagne

fp_acid  (soft 0 ← → 1 piercing)
  0.20 Amarone, warm Zinfandel, off-dry Gewurztraminer
  0.40 ripe Napa Cabernet, Rhône blends
  0.55 Chianti, Rioja
  0.75 Chablis, Sancerre, Barbera, Nebbiolo, Champagne
  0.90 Riesling, Assyrtiko, Muscadet

fp_tannin  (0 = none for white/rosé/sparkling/white-dessert)
  For reds, CALIBRATE AGAINST THE GRAPE (see grape guidance below):
  0.25 Beaujolais Gamay, light Pinot Noir
  0.45 Grenache, Sangiovese
  0.60 Cabernet Franc, Merlot
  0.75 Cabernet Sauvignon, Syrah
  0.90 Nebbiolo, Tannat, Sagrantino, Aglianico

fp_fruit_dark  (0 = pure red/citrus/stone fruit, 1 = pure black fruit)
  For non-reds: 0.
  0.10 Pinot Noir, Nebbiolo (red fruit dominant)
  0.30 Sangiovese, Grenache
  0.55 Merlot
  0.80 Cabernet Sauvignon, Syrah, Malbec
  0.90 Petite Sirah, extracted Zinfandel

fp_ripe  (tart/underripe 0 ← → 1 jammy)
  0.20 Muscadet, austere Chablis, unripe Sauvignon Blanc
  0.40 cool-climate Pinot Noir, Chianti Classico
  0.55 balanced Bordeaux
  0.75 Napa Cabernet, McLaren Vale Shiraz
  0.90 Amarone, Zinfandel, late-harvest wines

fp_oak  (none/steel 0 ← → 1 heavy new oak)
  0.05 stainless-fermented Sauvignon Blanc, Muscadet, most Riesling
  0.20 subtle old-oak use, traditional Barolo
  0.45 modern Barolo, Rioja Crianza
  0.70 California Chardonnay with new French oak
  0.90 heavily-oaked New World Chardonnay/Cabernet, American-oaked Rioja Gran Reserva

fp_body  (very light 0 ← → 1 full)
  0.15 Vinho Verde, off-dry Mosel Riesling
  0.35 Pinot Grigio, Beaujolais Gamay
  0.55 Chianti, cool-climate Chardonnay
  0.75 Napa Cabernet, oaked Chardonnay
  0.90 Amarone, Zinfandel, Barossa Shiraz

fp_savory  (pure-fruit 0 ← → 1 earthy/mineral/saline/leather/tobacco)
  This axis is under-used in v1 — deliberately push it away from the low end when the note mentions ANY savory descriptor.
  0.10 pure-fruit-forward with zero savory/mineral/earth descriptors (jammy Zinfandel, ripe fruit-bomb Chardonnay)
  0.25 ripe New World Chardonnay with subtle mineral edge
  0.40 mainstream Bordeaux with light cedar
  0.60 Chablis, Sancerre (wet stone, chalk), traditional Rioja (leather)
  0.75 Muscadet, Santorini Assyrtiko (saline), aged Rioja (heavy leather/tobacco)
  0.90 Etna Rosso, aged Nebbiolo (tar/truffle/forest floor), Manzanilla Sherry

=== GRAPE CALIBRATION (critical for tannin, body, acid) ===

Anchor your reading within the grape's own range. "Firm tannin" on Pinot Noir is 0.45; on Nebbiolo it is 0.80.

  Pinot Noir     tannin 0.20–0.55, body 0.35–0.60, acid 0.55–0.80, red fruit
  Gamay          tannin 0.15–0.40, body 0.30–0.55, acid 0.55–0.75, red fruit
  Nebbiolo       tannin 0.65–0.95, body 0.55–0.75, acid 0.70–0.85, red fruit
  Sangiovese     tannin 0.45–0.70, body 0.45–0.65, acid 0.60–0.80
  Cabernet Sauvignon  tannin 0.60–0.90, body 0.65–0.90, acid 0.35–0.60, black fruit
  Merlot         tannin 0.40–0.70, body 0.55–0.80, acid 0.40–0.60
  Syrah/Shiraz   tannin 0.55–0.85, body 0.60–0.90, acid 0.40–0.65, black fruit
  Grenache       tannin 0.30–0.55, body 0.55–0.80, acid 0.30–0.55
  Zinfandel      tannin 0.35–0.65, body 0.65–0.90, acid 0.30–0.55, ripe
  Chardonnay     acid 0.35–0.80 (wide — cool vs warm), body 0.40–0.85 (steel vs oak)
  Sauvignon Blanc acid 0.65–0.90, body 0.20–0.45, savory when mineral
  Riesling       acid 0.75–0.95, body 0.20–0.55
  Chenin Blanc   acid 0.60–0.85, body 0.25–0.65
  Albariño       acid 0.65–0.85, body 0.30–0.50, savory 0.45–0.70 (saline)
  Assyrtiko      acid 0.75–0.90, body 0.35–0.55, savory 0.65–0.85 (saline/volcanic)
  Melon de Bourgogne (Muscadet) acid 0.80–0.95, savory 0.60–0.80

If the grape is not in this list, use the type default range and the note.

=== NOTE → SCORE HARD MAPPINGS ===

Apply these strictly in both directions.

  - Any of: minerality, salinity, wet stone, chalk, flint, gunflint, iodine, sea spray, oyster shell, earth, forest floor, truffle, tar, leather, tobacco, cedar, graphite, umami → fp_savory ≥ 0.55. Two or more descriptors → ≥ 0.65. Three or more → ≥ 0.75.
  - Note reads pure-fruit with no savory descriptors AND no oak → fp_savory ≤ 0.20.
  - jammy, opulent, hedonistic, lush, super-ripe, raisiny → fp_ripe ≥ 0.75.
  - tart, underripe, sour, green, austere, lean → fp_ripe ≤ 0.35.
  - new oak, vanilla, toast, coconut, sawdust, mocha → fp_oak ≥ 0.55.
  - unoaked, stainless, steel-fermented, no oak → fp_oak ≤ 0.15.
  - grippy, chewy, drying, firm tannins → fp_tannin toward the high end OF THE GRAPE'S RANGE.
  - silky, plush, soft tannins, gentle → fp_tannin toward the low end OF THE GRAPE'S RANGE.
  - piercing acid, racy, mouth-watering, high-toned → fp_acid ≥ 0.75.
  - soft, round, low acid → fp_acid ≤ 0.40.

=== TYPE CONSTRAINTS ===

  - white / rosé / sparkling: fp_tannin = 0, fp_fruit_dark = 0.
  - dessert-white (Sauternes/Tokaji/ice/late-harvest whites): fp_tannin = 0.
  - fortified reds (Port/Banyuls/Maury): use real tannin.

ax_sweet 0..1: 0 = bone dry; 0.15 = off-dry; 0.5 = medium-sweet; 1 = dessert/PX/Sauternes.

Output shape:
{ "fp": { "fresh":0,"acid":0,"tannin":0,"fruit_dark":0,"ripe":0,"oak":0,"body":0,"savory":0 },
  "ax_sweet": 0 }`;

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

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const FINGERPRINT_MODEL = "google/gemini-2.5-flash";
const MODEL = FINGERPRINT_MODEL;

/**
 * Provenance for the current blinded_v2 pipeline. The hash is the sha256 of
 * `NOTE_SYS + "\n---\n" + SCORE_SYS`, computed at build time and mirrored in
 * the `fingerprint_prompts` table (see migration 2026-07-27). Every fp_ write
 * MUST record model, hash, pipeline, and scored_at — no defaults, no guesses.
 * If the prompt text above is edited the hash changes; recompute with:
 *   node -e 'const c=require("crypto");const fs=require("fs");const s=fs.readFileSync("src/lib/fingerprint-prompt.ts","utf8");const g=n=>s.match(new RegExp("const "+n+"\\\\s*=\\\\s*`([\\\\s\\\\S]*?)`;"))[1];console.log(c.createHash("sha256").update(g("NOTE_SYS")+"\\n---\\n"+g("SCORE_SYS")).digest("hex"));'
 * and register the new hash + full prompt text in `fingerprint_prompts`.
 */
export const FINGERPRINT_PROMPT_HASH =
  "4ed2de2f8b0d31da0df4abe957d2f39ab3bc850f236d60aeffcf0317dc0e0772";
export const FINGERPRINT_PIPELINE = "blinded_v2";


async function gatewayCall(system: string, user: string, apiKey: string): Promise<any> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
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
  try { return JSON.parse(content); }
  catch {
    const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned);
  }
}

/** Step 1 — sighted DESCRIPTIVE note. Sees the label; forbidden from evaluating. */
export async function generateTastingNote(input: FingerprintInput, apiKey: string): Promise<string> {
  const userMsg = JSON.stringify({
    producer: input.producer,
    cuvee: input.name,
    type: input.type,
    region: input.region ?? null,
    country: input.country ?? null,
    grape: input.grape ?? null,
    vintage: input.vintage ?? null,
  });
  const parsed = await gatewayCall(NOTE_SYS, userMsg, apiKey);
  return String(parsed?.tasting_note ?? "").slice(0, 400);
}

/** Step 2 — blind, grape-aware score. Sees ONLY type, grape, and the note. */
export async function scoreFromNote(
  type: string,
  grape: string | null | undefined,
  tasting_note: string,
  apiKey: string,
): Promise<{ fp: FpValues; ax_sweet: number }> {
  const userMsg = JSON.stringify({ type, grape: grape ?? null, tasting_note });
  const parsed = await gatewayCall(SCORE_SYS, userMsg, apiKey);
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
  if (type !== "red" && type !== "dessert") {
    fp.tannin = 0;
    fp.fruit_dark = 0;
  }
  const ax_sweet = clamp01(parsed?.ax_sweet ?? 0);
  return { fp, ax_sweet };
}

/** Full pipeline: descriptive note (sighted) → grape-aware blind score. */
export async function callFingerprintGateway(
  input: FingerprintInput,
  apiKey: string,
): Promise<FingerprintResult> {
  const tasting_note = await generateTastingNote(input, apiKey);
  const { fp, ax_sweet } = await scoreFromNote(input.type, input.grape, tasting_note, apiKey);
  return { fp, ax_sweet, tasting_note };
}

/** Kept for callers that still import the constant. Points at the blind-scoring
 *  system prompt now — the sighted note stage is separate. */
export const FINGERPRINT_SYS = SCORE_SYS;
