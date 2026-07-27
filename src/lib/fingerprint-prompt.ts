// Blinded two-step fingerprint pipeline.
//
// Step 1 (SIGHTED) — the model sees producer, cuvée, region, grape, vintage,
//   and writes a concise sommelier tasting note. No numbers requested.
// Step 2 (BLIND)   — a fresh completion sees ONLY the wine type and the
//   tasting note (no producer, no region, no grape, no vintage) and returns
//   the numeric fingerprint. Reputation priors cannot bias the score because
//   the scorer never sees the label. Invariant 11 compliance by construction.
//
// The old single-call callFingerprintGateway (which produced fp + note in one
// completion and could contradict itself — see Rossj-Bass fp_savory 0.20
// alongside "mineral, saline, unoaked") is replaced.

const NOTE_SYS = `You are a wine sommelier. Given one wine's identity, write ONE concise tasting note (max 220 chars) describing aroma, palate, structure, and character — like a sommelier note, not marketing copy. Return STRICT JSON only, no markdown.

Do NOT include any 0..1 numeric scores. Prose only.

Output shape: { "tasting_note": "..." }`;

const SCORE_SYS = `You are a wine sommelier translating a tasting note into a CALIBRATED 0..1 style fingerprint. You will be given a wine TYPE and a tasting NOTE. You will NOT be told the producer, region, grape, or vintage — do not guess them and do not import reputation priors. Score ONLY what the note describes. Return STRICT JSON only.

DO NOT default to 0.5. Use the full range. Values clamped 0..1.

Axis anchors:
  fresh      0 = flat/heavy/oxidative     0.5 = neutral   1 = racy/vibrant
  acid       0 = soft/round               0.5 = medium    1 = piercing / high-acid
  tannin     0 = none (whites/rosé/sparkling/white-dessert)   0.3 = silky   0.6 = firm   0.85 = grippy
  fruit_dark 0 = pure red fruit (or non-red types)   0.5 = mixed   1 = pure black fruit
  ripe       0 = tart/underripe           0.5 = balanced   1 = jammy
  oak        0 = none/steel               0.5 = subtle     1 = heavy new oak
  body       0 = very light               0.5 = medium     1 = full
  savory     0 = pure fruit-forward, no earth/mineral/savory/leather/tobacco/graphite/salinity
             0.5 = mixed
             1  = very savory/earthy/mineral/tar/leather

CRITICAL note→score mappings (apply strictly, in both directions):
  - Note mentions minerality, salinity, wet stone, chalk, flint, gunflint, earthy,
    graphite, tobacco, cedar, leather, forest floor, truffle, tar, or umami:
    fp_savory >= 0.50 (>= 0.60 if two or more of these appear).
  - Note reads pure-fruit-forward with no savory descriptors AND no oak:
    fp_savory <= 0.20.
  - Note mentions jammy, opulent, hedonistic, lush, super-ripe, raisiny:
    fp_ripe >= 0.75.
  - Note mentions tart, underripe, sour, green, austere: fp_ripe <= 0.35.
  - Note mentions new oak, vanilla, toast, coconut, sawdust, mocha:
    fp_oak >= 0.55.
  - Note mentions unoaked, stainless, steel-fermented, no oak: fp_oak <= 0.15.
  - Note mentions grippy, chewy, drying, firm-tannin: fp_tannin >= 0.65.
  - Note mentions silky, plush, soft-tannin, gentle: fp_tannin <= 0.40.

Type constraints:
  - For white, rosé, and sparkling wines: fp_tannin = 0 and fp_fruit_dark = 0.
  - For dessert wines: white dessert (Sauternes/Tokaji/ice) tannin = 0; fortified reds (Port/Banyuls/Maury) use real tannin.

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
const MODEL = "google/gemini-2.5-flash";

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

/** Step 1 — sighted tasting note. Sees the label. */
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

/** Step 2 — blind score. Sees ONLY the type and the note. No label. */
export async function scoreFromNote(
  type: string,
  tasting_note: string,
  apiKey: string,
): Promise<{ fp: FpValues; ax_sweet: number }> {
  const userMsg = JSON.stringify({ type, tasting_note });
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

/** Full pipeline: note (sighted) → score (blind). Two LLM calls per wine. */
export async function callFingerprintGateway(
  input: FingerprintInput,
  apiKey: string,
): Promise<FingerprintResult> {
  const tasting_note = await generateTastingNote(input, apiKey);
  const { fp, ax_sweet } = await scoreFromNote(input.type, tasting_note, apiKey);
  return { fp, ax_sweet, tasting_note };
}

/** Kept for callers that still import the constant. Points at the blind-scoring
 *  system prompt now — the sighted note stage is separate. */
export const FINGERPRINT_SYS = SCORE_SYS;

