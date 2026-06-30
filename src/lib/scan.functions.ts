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
  type: z.enum(["red", "white", "sparkling", "rose"]).nullable().optional(),
  fp: FpSchema.nullable().optional(),
  confidence: z.enum(["high", "medium", "low"]).nullable().optional(),
});

export type ScannedWine = z.infer<typeof WineSchema>;

const PROMPT = `You are reading a photo of a restaurant wine list. Return ONLY valid JSON — no prose, no markdown fences. Read EVERY wine visible on the list.

For each wine, output an object with:
  producer, wine_name, vintage (int or null), region, grape, price (string or null)
  type: "red" | "white" | "sparkling" | "rose" — classify each wine. Champagne / Prosecco / Cava / Crémant / Franciacorta / Sekt / Lambrusco => sparkling. Rosé / rosado / rosato => rose. Otherwise red or white based on grape.
  fp: eight style values, each a float 0..1, INFERRED from your knowledge of that producer/grape/region/vintage:
    fresh      0 = flat/heavy/tiring   1 = racy, high-lift, vibrant
    acid       0 = soft/round/low      1 = piercing/high (Chablis, Nebbiolo)
    tannin     0 = none (white/rosé)   0.3 silky (Pinot)  0.9 grippy (young Barolo/Cab)
    fruit_dark 0 = red fruit (cherry)  1 = black fruit (cassis, blackberry)
    ripe       0 = tart/lean           0.5 balanced       1 = jammy/overripe
    oak        0 = none/steel          1 = heavy new oak (vanilla, toast, mocha)
    body       0 = very light          0.5 medium         1 = full/powerful
    savory     0 = pure fruit          1 = very savory/earthy (truffle, leather, tar)
  confidence: "high" | "medium" | "low" — how sure you are of the fp inference.

Rules:
- Include every wine, even if you must guess. If a line is illegible or the wine is unknown to you, set unknown fields to null, give your best fp guess, confidence "low".
- For non-reds, tannin and fruit_dark should be ~0 (they will be ignored anyway).
- Do NOT invent wines that aren't on the list.
- Output shape: { "wines": [ { ... }, ... ] }`;

export const scanWineList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      image_base64: z.string().min(100),
      media_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic"]),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const dataUrl = `data:${data.media_type};base64,${data.image_base64}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
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
    try {
      parsed = JSON.parse(content);
    } catch {
      // strip code fences if model added them
      const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      parsed = JSON.parse(cleaned);
    }

    const shape = z.object({ wines: z.array(WineSchema) }).safeParse(parsed);
    if (!shape.success) {
      throw new Error("Vision returned an unexpected shape.");
    }
    return { wines: shape.data.wines };
  });
