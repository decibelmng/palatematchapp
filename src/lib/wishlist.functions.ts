// Wishlist server functions — "want to try" from feed / scan / search.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WishlistRow = {
  id: string;
  bottle_id: string;
  source_context: string | null;
  created_at: string;
};

export type WishlistBottle = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  grape: string | null;
  vintage: number | null;
  type: string | null;
  price_band: string | null;
  fp_fresh: number | null;
  fp_acid: number | null;
  fp_tannin: number | null;
  fp_fruit_dark: number | null;
  fp_ripe: number | null;
  fp_oak: number | null;
  fp_body: number | null;
  fp_savory: number | null;
};

export type WishlistItem = WishlistRow & { bottle: WishlistBottle };

const AddInput = z.object({
  bottle_id: z.string().uuid(),
  source_context: z.enum(["feed", "scan", "search", "wine", "other"]).default("other"),
});

export const addToWishlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => AddInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ id: string; created: boolean }> => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("wishlist")
      .upsert(
        { user_id: userId, bottle_id: data.bottle_id, source_context: data.source_context },
        { onConflict: "user_id,bottle_id", ignoreDuplicates: false },
      )
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, created: true };
  });

const RemoveInput = z.object({ bottle_id: z.string().uuid() });

export const removeFromWishlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => RemoveInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("wishlist")
      .delete()
      .eq("user_id", userId)
      .eq("bottle_id", data.bottle_id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const listWishlist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WishlistItem[]> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("wishlist")
      .select("id, bottle_id, source_context, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return [];
    const ids = rows.map((r) => r.bottle_id);
    const { data: bottles, error: bErr } = await supabase
      .from("bottles")
      .select(
        "id, name, producer, region, grape, vintage, type, price_band, fp_fresh, fp_acid, fp_tannin, fp_fruit_dark, fp_ripe, fp_oak, fp_body, fp_savory",
      )
      .in("id", ids);
    if (bErr) throw new Error(bErr.message);
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    return rows
      .map((r) => {
        const b = byId.get(r.bottle_id);
        if (!b) return null;
        return { ...r, bottle: b as WishlistBottle };
      })
      .filter((x): x is WishlistItem => x !== null);
  });
