import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callFingerprintGateway } from "@/lib/fingerprint-prompt";

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

    // --- LLM research (shared calibrated prompt) ---
    const { fp, ax_sweet, tasting_note } = await callFingerprintGateway(
      {
        producer: data.producer,
        name: data.name,
        type: data.type,
        region: data.region ?? null,
        country: data.country ?? null,
        grape: data.grape ?? null,
        vintage: data.vintage ?? null,
      },
      key,
    );

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
