// READ-ONLY admin catalog QA: server functions.
// Returns raw bottles data for the /admin/style-map diagnostic. No writes.
// All engine scoring paths (recommender.ts, lanes.ts, style-neighbors.ts) are
// untouched — this is diagnostic-only.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || userId !== adminId) throw new Error("Not authorized");
}

const TYPES = ["red", "white", "rose", "sparkling", "dessert"] as const;
type Type = (typeof TYPES)[number];

export type StyleMapRow = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  grape: string | null;
  type: Type;
  source: string | null;
  unverified: boolean;
  vintage: number | null;
  fp: {
    fresh: number; acid: number; tannin: number; fruit_dark: number;
    ripe: number; oak: number; body: number; savory: number;
  };
};

export const adminStyleMapFetch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { type: string }) => {
    if (!TYPES.includes(input.type as Type)) throw new Error("Invalid type");
    return { type: input.type as Type };
  })
  .handler(async ({ context, data }): Promise<StyleMapRow[]> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const PAGE = 10000;
    const rows: StyleMapRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: chunk, error } = await supabaseAdmin
        .from("bottles")
        .select(
          "id,name,producer,region,grape,type,source,unverified,vintage," +
            "fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory"
        )
        .eq("type", data.type)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!chunk || chunk.length === 0) break;
      for (const b of chunk as any[]) {
        rows.push({
          id: b.id, name: b.name, producer: b.producer, region: b.region,
          grape: b.grape, type: b.type, source: b.source,
          unverified: !!b.unverified, vintage: b.vintage,
          fp: {
            fresh: b.fp_fresh, acid: b.fp_acid, tannin: b.fp_tannin,
            fruit_dark: b.fp_fruit_dark, ripe: b.fp_ripe, oak: b.fp_oak,
            body: b.fp_body, savory: b.fp_savory,
          },
        });
      }
      if (chunk.length < PAGE) break;
    }
    return rows;
  });

export const adminStyleMapNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (typeof input.id !== "string" || input.id.length < 8) throw new Error("Invalid id");
    return { id: input.id };
  })
  .handler(async ({ context, data }): Promise<string | null> => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("bottles").select("tasting_note").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    return (row?.tasting_note as string | null) ?? null;
  });
