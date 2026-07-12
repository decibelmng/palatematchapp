import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Mirror the generated client's fetch: set apikey header and strip a
// bearer-format Authorization for new-style sb_publishable_ keys, which are
// opaque strings rather than JWTs.
function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}
function createPublicSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}
async function createPublicSupabase() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, {
    global: { fetch: createPublicSupabaseFetch(key) },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

// ============================================================================
// Search & create restaurants
// ============================================================================

export const searchRestaurantsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ q: z.string().min(1).max(100) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("search_restaurants", {
      q: data.q,
      lim: 10,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as { id: string; name: string; city: string | null; locale: string | null }[];
  });

export const createRestaurantFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      name: z.string().min(1).max(200),
      city: z.string().max(100).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("restaurants")
      .insert({
        name: data.name.trim(),
        city: data.city?.trim() || null,
        created_by: context.userId,
      })
      .select("id,name,city")
      .single();
    if (error) throw new Error(error.message);
    return row!;
  });

// ============================================================================
// Attribute a scan → restaurant. Upserts wines into restaurant_wines,
// creating community bottles for wines that weren't matched to the catalog.
// ============================================================================

const AttributeInput = z.object({
  scan_id: z.string().uuid(),
  restaurant_id: z.string().uuid(),
});

export const attributeScanFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AttributeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load the scan (owner-only via RLS).
    const { data: scan, error: scanErr } = await supabase
      .from("scan_logs")
      .select("id,user_id,wines,restaurant_id")
      .eq("id", data.scan_id)
      .single();
    if (scanErr || !scan) throw new Error("Scan not found");
    if (scan.user_id !== userId) throw new Error("Not your scan");

    // Confirm the restaurant exists (readable to all).
    const { data: rest, error: restErr } = await supabase
      .from("restaurants")
      .select("id,name")
      .eq("id", data.restaurant_id)
      .single();
    if (restErr || !rest) throw new Error("Restaurant not found");

    // Use admin client for the aggregate-graph writes so RLS-tightened
    // restaurant_wines table (service-role only) accepts them.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Attribute the scan itself.
    await supabaseAdmin
      .from("scan_logs")
      .update({ restaurant_id: data.restaurant_id })
      .eq("id", scan.id);

    const wines = (scan.wines ?? []) as Array<{
      producer?: string | null;
      wine_name?: string | null;
      vintage?: number | null;
      region?: string | null;
      grape?: string | null;
      price?: string | null;
      type?: "red" | "white" | "sparkling" | "rose" | "dessert" | null;
      fp_resolved?: {
        fresh: number; acid: number; tannin: number; fruit_dark: number;
        ripe: number; oak: number; body: number; savory: number;
      } | null;
      fp_source?: "catalog" | "estimated" | "unreadable";
      matched_bottle_id?: string | null;
    }>;

    let upserted = 0;
    let createdBottles = 0;
    const now = new Date().toISOString();

    for (const w of wines) {
      if (!w.fp_resolved) continue; // unreadable
      let bottleId = w.matched_bottle_id ?? null;

      // Non-match: create a community bottle (unverified) from the vision fp.
      if (!bottleId) {
        const name = (w.wine_name ?? "").trim() || "Unknown cuvée";
        const producer = (w.producer ?? "").trim() || null;
        const type = w.type ?? "red";
        const keepsTannin = type === "red" || type === "dessert";
        const { data: newB, error: bErr } = await supabaseAdmin
          .from("bottles")
          .insert({
            name,
            producer,
            region: w.region ?? null,
            grape: w.grape ?? null,
            vintage: w.vintage ?? null,
            type,
            fp_fresh: w.fp_resolved.fresh,
            fp_acid: w.fp_resolved.acid,
            fp_tannin: keepsTannin ? w.fp_resolved.tannin : 0,
            fp_fruit_dark: keepsTannin ? w.fp_resolved.fruit_dark : 0,
            fp_ripe: w.fp_resolved.ripe,
            fp_oak: w.fp_resolved.oak,
            fp_body: w.fp_resolved.body,
            fp_savory: w.fp_resolved.savory,
            ax_body: w.fp_resolved.body,
            ax_fruit_char: w.fp_resolved.savory,
            ax_tannin: keepsTannin ? w.fp_resolved.tannin : 0,
            ax_acidity: w.fp_resolved.acid,
            ax_sweet: 0,
            source: "scan; unverified community bottle",
            added_by: userId,
            unverified: true,
          })
          .select("id")
          .single();
        if (bErr || !newB) continue;
        bottleId = newB.id;
        createdBottles++;
      }

      // Parse price into a numeric amount for sortability. Keep raw string too.
      const priceStr = (w.price ?? "").trim() || null;
      const amountMatch = priceStr?.match(/(\d[\d.,]*)/);
      const amount = amountMatch
        ? Number(amountMatch[1].replace(/,/g, "").replace(/\.(?=\d{3}\b)/g, ""))
        : null;

      // Upsert the graph edge.
      const { data: existing } = await supabaseAdmin
        .from("restaurant_wines")
        .select("id,seen_count")
        .eq("restaurant_id", data.restaurant_id)
        .eq("bottle_id", bottleId)
        .maybeSingle();

      if (existing) {
        await supabaseAdmin
          .from("restaurant_wines")
          .update({
            last_seen_at: now,
            seen_count: (existing.seen_count ?? 1) + 1,
            menu_price: priceStr ?? undefined,
            menu_price_amount: amount ?? undefined,
            source_scan_id: scan.id,
          })
          .eq("id", existing.id);
      } else {
        await supabaseAdmin.from("restaurant_wines").insert({
          restaurant_id: data.restaurant_id,
          bottle_id: bottleId,
          menu_price: priceStr,
          menu_price_amount: amount,
          first_seen_at: now,
          last_seen_at: now,
          seen_count: 1,
          source_scan_id: scan.id,
          added_by: userId,
        });
      }
      upserted++;
    }

    return {
      restaurant_id: data.restaurant_id,
      restaurant_name: rest.name,
      upserted,
      createdBottles,
    };
  });

// ============================================================================
// List all restaurants (recent) and get one restaurant's wine graph.
// Public reads — no auth middleware required, but we still gate to keep the
// interface simple.
// ============================================================================

export const listRestaurantsFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const supabase = await createPublicSupabase();
    const { data, error } = await supabase
      .from("restaurants")
      .select("id,name,city,locale,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getRestaurantWinesFn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ restaurant_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const supabase = await createPublicSupabase();
    const { data: rest, error: rErr } = await supabase
      .from("restaurants")
      .select("id,name,city,locale")
      .eq("id", data.restaurant_id)
      .single();
    if (rErr || !rest) throw new Error("Restaurant not found");

    const { data: rows, error } = await supabase
      .from("restaurant_wines")
      .select(`
        id,menu_price,menu_price_amount,first_seen_at,last_seen_at,seen_count,
        bottle:bottles(
          id,name,producer,region,grape,vintage,type,critic_score,price_band,
          fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,
          ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet,tasting_note,source
        )
      `)
      .eq("restaurant_id", data.restaurant_id)
      .order("last_seen_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    return {
      restaurant: rest,
      wines: (rows ?? []).filter((r: any) => r.bottle).map((r: any) => ({
        id: r.id,
        menu_price: r.menu_price as string | null,
        menu_price_amount: r.menu_price_amount as number | null,
        first_seen_at: r.first_seen_at as string,
        last_seen_at: r.last_seen_at as string,
        seen_count: r.seen_count as number,
        bottle: r.bottle,
      })),
    };
  });
