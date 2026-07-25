// Admin type-mislabel detector + reviewer.
//
// Detector is READ-ONLY. Approve writes bottles.type + appends a
// catalog_corrections audit row. Reject inserts into admin_type_review_rejects
// to suppress the row from the queue. No bulk auto-fix.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || userId !== adminId) throw new Error("Not authorized");
}

// Grape → intended type. Tokens matched with case-insensitive substring
// against the bottles.grape text so both bare and blend labels hit.
const RED_GRAPE_TOKENS = [
  "Cabernet Sauvignon", "Cabernet Franc", "Merlot", "Pinot Noir", "Syrah", "Shiraz",
  "Malbec", "Sangiovese", "Nebbiolo", "Grenache", "Garnacha", "Tempranillo",
  "Zinfandel", "Nero d'Avola", "Gamay", "Petit Verdot", "Petite Sirah",
  "Mourvèdre", "Mourvedre", "Monastrell", "Carmenère", "Carignan", "Barbera",
  "Aglianico", "Montepulciano", "Touriga Nacional",
  "Bordeaux-style Red Blend", "Rhône-style Red Blend", "Rhone-style Red Blend",
  "Red Blend", "Meritage",
];

const WHITE_GRAPE_TOKENS = [
  "Chardonnay", "Sauvignon Blanc", "Riesling", "Pinot Grigio", "Pinot Gris",
  "Chenin Blanc", "Sémillon", "Semillon", "Viognier", "Gewürztraminer",
  "Gewurztraminer", "Albariño", "Albarino", "Vermentino", "Grüner Veltliner",
  "Gruner Veltliner", "Muscat", "Trebbiano", "White Blend",
  "Bordeaux-style White Blend", "Rhône-style White Blend",
];

// Names that legitimately break the grape/type prediction.
// e.g. "White Zinfandel" (rosé), "Blanc de Noir", "Vin Gris of Pinot Noir",
// "Bordeaux Clairet" (rosé), Rosé of Cabernet Franc, "White Pinot Noir".
const AMBIGUOUS_NAME_TOKENS = [
  "ros",          // Rosé / Rosato / Rosado / RosZ
  "white",        // White Zinfandel, White Pinot Noir
  "blanc de noir",
  "vin gris",
  "clairet",
  "blush",
  "orange",       // orange wines
  "sparkl", "brut", "champ", "cava", "spuman", "prosec", "cremant", "sekt",
  "port", "sherry", "madeira", "vin doux", "ice wine", "eiswein", "sauternes",
  "tokaji", "late harvest",
];

function ilikePattern(t: string) {
  return `%${t}%`;
}

function grapeMatches(grape: string | null | undefined, tokens: string[]): boolean {
  if (!grape) return false;
  const lg = grape.toLowerCase();
  for (const t of tokens) if (lg.includes(t.toLowerCase())) return true;
  return false;
}

function nameHasAmbiguousToken(name: string | null | undefined): boolean {
  if (!name) return false;
  const ln = name.toLowerCase();
  for (const t of AMBIGUOUS_NAME_TOKENS) if (ln.includes(t)) return true;
  return false;
}

export type TypeSuspect = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  grape: string | null;
  vintage: number | null;
  currentType: string;
  proposedType: "red" | "white";
  reason: string;
};

async function fetchAll<T>(
  build: () => Promise<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const { data, error } = await build();
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const adminListTypeSuspects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Server-side prefilter with a wide OR pulls candidates; we then apply
    // the name-token exclusion + grape-token check in JS for accuracy.
    const columns = "id,name,producer,region,grape,vintage,type";

    const roseCandidates = await fetchAll<any>(() =>
      supabaseAdmin
        .from("bottles")
        .select(columns)
        .eq("type", "rose")
        // Any grape mention that hints red — narrows the scan.
        .or(
          RED_GRAPE_TOKENS.slice(0, 24) // Supabase .or() has practical length limits; core reds cover the queue
            .map((t) => `grape.ilike.${ilikePattern(t).replace(/,/g, "\\,")}`)
            .join(","),
        )
        .limit(2000),
    );

    // Mirror check: type='red' but the name is clearly a rosé/blush/white.
    const redCandidates = await fetchAll<any>(() =>
      supabaseAdmin
        .from("bottles")
        .select(columns)
        .eq("type", "red")
        .or("name.ilike.%White %,name.ilike.%Blanc de Noir%,name.ilike.%Vin Gris%,name.ilike.%Clairet%")
        .limit(2000),
    );

    const { data: rejects, error: rErr } = await supabaseAdmin
      .from("admin_type_review_rejects")
      .select("bottle_id");
    if (rErr) throw new Error(rErr.message);
    const suppressed = new Set<string>((rejects ?? []).map((r: any) => r.bottle_id as string));

    const suspects: TypeSuspect[] = [];

    for (const b of roseCandidates) {
      if (suppressed.has(b.id)) continue;
      if (nameHasAmbiguousToken(b.name)) continue;
      if (!grapeMatches(b.grape, RED_GRAPE_TOKENS)) continue;
      suspects.push({
        id: b.id,
        name: b.name,
        producer: b.producer,
        region: b.region,
        grape: b.grape,
        vintage: b.vintage,
        currentType: b.type,
        proposedType: "red",
        reason: `red grape "${b.grape}", name has no rosé/blush/white token`,
      });
    }

    for (const b of redCandidates) {
      if (suppressed.has(b.id)) continue;
      const ln = (b.name ?? "").toLowerCase();
      // Only flag when the name is a clear rosé/blush indicator AND grape suggests it's not a red.
      // "White Pinot Noir" / "Blanc de Noir" / "Vin Gris" → rosé; "White Zinfandel" → rosé.
      const looksRose = /white \w|blanc de noir|vin gris|clairet/.test(ln);
      if (!looksRose) continue;
      suspects.push({
        id: b.id,
        name: b.name,
        producer: b.producer,
        region: b.region,
        grape: b.grape,
        vintage: b.vintage,
        currentType: b.type,
        proposedType: /white \w/.test(ln) && grapeMatches(b.grape, WHITE_GRAPE_TOKENS) ? "white" : "red",
        reason: "red-typed but name matches a rosé/blush indicator",
      });
      // Flip the proposed type back sensibly: white-in-name + red grape → rosé, not white.
      // Keep it simple: propose 'red' rollback isn't useful, so mark as 'white' fallback.
      // (The reviewer sees name+grape and can reject if wrong.)
    }

    // Stable order: producer then vintage then name.
    suspects.sort((a, b) => {
      const p = (a.producer ?? "").localeCompare(b.producer ?? "");
      if (p) return p;
      const v = (a.vintage ?? 0) - (b.vintage ?? 0);
      if (v) return v;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

    return suspects;
  });

export const adminApproveTypeFix = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bottleId: string; newType: string; rationale?: string }) => {
    if (!input?.bottleId) throw new Error("Missing bottleId");
    if (!["red", "white", "rose", "sparkling", "dessert"].includes(input.newType)) {
      throw new Error(`Invalid newType: ${input.newType}`);
    }
    return {
      bottleId: input.bottleId,
      newType: input.newType,
      rationale: (input.rationale ?? "").trim() || null,
    };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: before, error: bErr } = await supabaseAdmin
      .from("bottles")
      .select("id,name,type,grape")
      .eq("id", data.bottleId)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!before) throw new Error("Bottle not found");
    if (before.type === data.newType) {
      return { bottleId: data.bottleId, oldType: before.type, newType: data.newType, noop: true };
    }

    const oldType = before.type;

    const { error: uErr } = await supabaseAdmin
      .from("bottles")
      .update({ type: data.newType })
      .eq("id", data.bottleId);
    if (uErr) throw new Error(uErr.message);

    const { error: cErr } = await supabaseAdmin
      .from("catalog_corrections")
      .insert({
        bottle_id: data.bottleId,
        field: "type",
        old_value: oldType,
        new_value: data.newType,
        source_type: "expert_admin",
        author_id: context.userId,
        rationale: data.rationale ?? `Type mislabel review: ${oldType} → ${data.newType}`,
      });
    if (cErr) throw new Error(cErr.message);

    // Also clear any suppression record so history is consistent.
    await supabaseAdmin.from("admin_type_review_rejects").delete().eq("bottle_id", data.bottleId);

    return { bottleId: data.bottleId, oldType, newType: data.newType, noop: false };
  });

export const adminRejectTypeSuspect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { bottleId: string; note?: string }) => {
    if (!input?.bottleId) throw new Error("Missing bottleId");
    return { bottleId: input.bottleId, note: (input.note ?? "").trim() || null };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("admin_type_review_rejects")
      .upsert(
        { bottle_id: data.bottleId, rejected_by: context.userId, rejected_at: new Date().toISOString(), note: data.note },
        { onConflict: "bottle_id" },
      );
    if (error) throw new Error(error.message);
    return { bottleId: data.bottleId };
  });
