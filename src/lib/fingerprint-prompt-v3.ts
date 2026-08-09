// v3 — de-anchored blind scorer over REAL human tasting notes.
//
// Why v3 exists. v2's blind scorer was handed (a) per-grape calibration bands
// and (b) named-wine anchors for every axis ("0.75 Napa Cabernet", "0.90
// Nebbiolo"). Given a note it was unsure about, the cheapest correct-looking
// answer was the midpoint of the grape's band. That is a typicity lookup with
// extra steps, and the 78-wine pilot proved it: within-region variance went
// DOWN. Two Napa Cabernets cannot be told apart by a scorer whose strongest
// signal is the words "Cabernet Sauvignon".
//
// v3 removes both. The scorer sees the wine TYPE and the NOTE. Nothing else —
// no grape, no producer, no region, no vintage, no price, no points. Axis
// definitions are stated in sensory language with descriptor-level anchors
// (what words at what intensity), never with example wines. The only job is:
// read this note, report what it says.
//
// Notes come from public.catalog_source_notes (recovered Wine Enthusiast
// reviews), not from a model. Step 1 of v2 is not used here.

const SCORE_SYS_V3 = `You read ONE tasting note and report what it says as a 0..1 style fingerprint. Return STRICT JSON only, no markdown.

You are given the wine TYPE (red / white / rosé / sparkling / dessert / fortified) and the NOTE. That is all you get. You are NOT told the producer, grape variety, region, appellation, vintage, price, or critic score. Do not guess any of them, and do not let a guess influence a value. If the note names a place or a grape, ignore it — score the sensory words only.

Two notes from the same grape and the same region SHOULD receive different values whenever their words differ. Words like "brawny, mild acidity, chocolate, soft rounded layers" and "dry, classically structured, long and deep in cassis" describe two different wines, and your output must say so. Reporting the category average is the failure mode here.

Score what is WRITTEN. If the note says a wine is soft and low-acid, that is what it is, however unusual that seems for its kind.

=== NULL IS A REQUIRED ANSWER ===

If the note does not address an axis, return null for that axis. Not 0.5 — null.

0.5 is a real, central position. A wine whose note never mentions acidity is not a mid-acid wine; it is a wine whose acidity you do not know. Reporting 0.5 there makes the two indistinguishable and destroys the axis. Returning null is the correct, expected answer and costs nothing downstream: unread axes are excluded and the remaining ones are rescaled.

Do NOT infer a missing axis from an adjacent descriptor, from the other axes, or from what wines of this style usually do. "Crisp" is acid language and may be scored. "Bright red cherry" is fruit language and is NOT acid evidence — if that is all the note offers, fp_acid is null. Filling a gap with what the category usually does is the exact failure this prompt exists to remove.

Six real axes beat eight where two are guesses. Do not apologise for nulls and do not try to minimise how many you return.

Use the full 0..1 range for the axes you DO score. Reserve the extremes for notes whose language is extreme, and use them when it is.

=== AXES ===

Each axis is defined by intensity of language, not by any example wine. Every axis may be null.

fp_fresh — 0 flat, tired, oxidative, heavy, warm-feeling / 1 vibrant, lifted, crunchy, energetic, mouth-watering.
  Score only on explicit freshness/lift/energy language: lift, drive, energy, vibrant, fresh, "cuts", "zips" push up; baked, stewed, tired, flabby, oxidative, soft-edged push down. A note that describes only flavours and tannin says nothing about freshness → null.

fp_acid — 0 soft, round, low-acid, gentle / 1 piercing, racy, searing, tart-bright.
  Score only on explicit acidity or texture-of-acid language: "bright acidity", "racy", "mouth-watering", "crisp", "zesty", "lemon-edged", "tart" up; "soft", "round", "low acidity", "mild acidity", "creamy", "plush", "flabby" down. Named fruits, ripeness, oak and tannin are NOT acid evidence. No acid language → null.

fp_tannin — 0 no perceptible tannin / 1 massively grippy, drying, chewy, mouth-coating.
  Read intensity of the tannin words themselves, not what the wine probably is: "silky", "supple", "feathery", "polished", "gentle" low; "firm", "structured", "dusty", "grippy" middle-to-high; "chewy", "drying", "astringent", "tongue-sticky", "rugged", "brawny", "tough" high. A red note with no tannin or texture language at all → null.
  Non-reds: 0 (enforced downstream).

fp_fruit_dark — 0 purely red, citrus, or stone fruit / 1 purely black fruit.
  Read the named fruits. cherry, cranberry, raspberry, redcurrant, strawberry, pomegranate → low. plum, black cherry, boysenberry → middle. blackberry, blackcurrant, cassis, blueberry, black plum, fig → high. A note naming both red and black fruit sits between, weighted by which leads. A note naming no fruit → null.
  Non-reds: 0 (enforced downstream).

fp_ripe — 0 tart, green, underripe, austere, lean / 1 jammy, raisined, super-ripe, hedonistic.
  Read: green, herbaceous, unripe, sour, austere, "canned peas", stalky low; ripe, generous, juicy middle-high; jammy, opulent, lush, decadent, candied, raisiny, "super-ripe", port-like at the top. No ripeness language → null.

fp_oak — 0 no oak signature at all / 1 dominant new oak.
  "unoaked", "stainless", "steel-fermented" → near 0. cedar, tobacco leaf from wood, subtle spice → low-middle. vanilla, toast, mocha, caramel, coconut, sawdust, char, "smoky oak", "generously oaked" → high, and higher again when the note says the oak leads or dominates. A note that mentions neither oak nor its absence → null. (Silence is not evidence of no oak.)

fp_body — 0 water-light, delicate / 1 thick, heavy, mouth-filling.
  Read: light, lean, delicate, "compact", "lightly spritzy" low; medium-bodied, "weight", "richness" middle; full-bodied, dense, thick, syrupy, "sizable", "powerful weight", "concentrated and packed" high. Ignore alcohol guesses. No weight or texture language → null.

fp_savory — 0 pure fruit and nothing else / 1 dominated by earth, mineral, saline, leather, tobacco, meat.
  Read and COUNT the non-fruit savory descriptors: minerality, salinity, wet stone, chalk, flint, iodine, sea spray, oyster shell, earth, forest floor, mushroom, truffle, tar, leather, tobacco, graphite, pencil shavings, garrigue, dried herbs, olive, peat, smoke, bacon fat, soy, meat, umami.
  Zero such descriptors on a note that DOES describe flavour and names only fruit → 0.10–0.20 (this is real evidence of absence). One → about 0.55. Two → 0.65 or above. Three or more, or a note where earth/mineral clearly leads over fruit → 0.75 or above, up to 0.95. A note that describes no flavours at all → null.

ax_sweet — 0 bone dry; 0.15 off-dry / trace of sweetness; 0.5 medium-sweet; 1 full dessert or fortified-sweet. A stated residual sugar or "hint of sweetness" moves it off 0; "drinks dry" is 0. Ripe fruit is NOT sweetness. Null if the note gives no reading either way.

=== OUTPUT ===
Every value is a number 0..1 OR null. Use JSON null, never the string "null", never 0.5 as a stand-in.

{ "fp": { "fresh":null,"acid":null,"tannin":null,"fruit_dark":null,"ripe":null,"oak":null,"body":null,"savory":null },
  "ax_sweet": null }`;

import type { FpValues } from "./fingerprint-prompt";

/** Axis keys in canonical order. */
export const V3_AXES = [
  "fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory",
] as const satisfies readonly (keyof FpValues)[];

/** A v3 reading: every axis is a real 0..1 value or null for "the note does not say".
 *  Null is NEVER coerced to a number — not here, not on write, not on read. */
export type FpValuesNullable = { [K in keyof FpValues]: number | null };

/**
 * Clamp to 0..1 while preserving null. The v2 `clamp01` returns 0.5 for any
 * non-finite input, which is precisely the sentinel bug this pipeline removes:
 * 0.5 is a real central position and must never stand in for "unread".
 */
export function clamp01OrNull(n: unknown): number | null {
  if (n === null || n === undefined || n === "") return null;
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
}

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
export const FINGERPRINT_MODEL_V3 = "google/gemini-2.5-flash";
export const FINGERPRINT_PIPELINE_V3 = "note_v3_deanchored";
/** sha256 of SCORE_SYS_V3; recompute and re-register in `fingerprint_prompts`
 *  whenever the prompt text above changes:
 *    bun run scripts/fp-prompt-hash.ts
 */
export const FINGERPRINT_PROMPT_V3_TEXT = SCORE_SYS_V3;

async function gatewayCall(system: string, user: string, apiKey: string): Promise<any> {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model: FINGERPRINT_MODEL_V3,
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
  try {
    return JSON.parse(content);
  } catch {
    const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    return JSON.parse(cleaned);
  }
}

/**
 * v3 blind score. Sees ONLY the wine type and a real human tasting note.
 * No grape, no region, no producer, no price — nothing a typicity grid could
 * be rebuilt from.
 */
export async function scoreFromNoteV3(
  type: string,
  tasting_note: string,
  apiKey: string,
): Promise<{ fp: FpValues; ax_sweet: number }> {
  const userMsg = JSON.stringify({ type, tasting_note });
  const parsed = await gatewayCall(SCORE_SYS_V3, userMsg, apiKey);
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
  return { fp, ax_sweet: clamp01(parsed?.ax_sweet ?? 0) };
}
