import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cuveeKey } from "@/lib/price-verdict";


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
  const url = process.env.SUPABASE_URL || "https://xyxanewatmrekdqowqao.supabase.co";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_uBdGKhTkSyYWE3SJQXa-PA_wAxapy9_";
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

// The legacy scan → restaurant attribution path lived here (AttributeInput +
// attributeScanFn). It wrote scan_logs.restaurant_id and upserted
// restaurant_wines with community bottles built the old defaulting way — the
// pattern that made a missing fp value indistinguishable from a real extreme.
// scan_logs is a mirror nothing reads; attributeScanToVenueFn below is the
// live path, writing scans.restaurant_id. Deleted rather than deprecated, so
// nothing can quietly resurrect a second attribution surface.

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

// ============================================================================
// Attribute a persisted scan (scans.id) to a venue, AFTER results render.
//
// The older attributeScanFn writes scan_logs.restaurant_id — a mirror table
// nothing downstream reads. Venue cards, per-venue list history, saved
// restaurants and currency learning all key off scans.restaurant_id and the
// fact tables, so attribution has to land there. It also re-runs the same
// capture finalize does, because a scan attributed later must produce the same
// facts as one attributed up front.
// ============================================================================

export const attributeScanToVenueFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      scan_id: z.string().uuid(),
      restaurant_id: z.string().uuid(),
      scan_log_id: z.string().uuid().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: scan, error: scanErr } = await supabase
      .from("scans")
      .select("id,user_id,scanned_at,currency,restaurant_id")
      .eq("id", data.scan_id)
      .single();
    if (scanErr || !scan) throw new Error("Scan not found");
    if (scan.user_id !== userId) throw new Error("Not your scan");

    const { data: rest, error: restErr } = await supabase
      .from("restaurants")
      .select("id,name,currency")
      .eq("id", data.restaurant_id)
      .single();
    if (restErr || !rest) throw new Error("Restaurant not found");

    const { error: upErr } = await supabase
      .from("scans")
      .update({ restaurant_id: data.restaurant_id })
      .eq("id", data.scan_id);
    if (upErr) throw new Error(upErr.message);

    // Read the row back. An UPDATE that matches no row under RLS returns rows=0
    // and error=null, so `!upErr` alone is not evidence the write landed — and a
    // success toast on top of a no-op is how attribution stayed silently broken
    // for 79 scans. Verify, or fail loudly.
    const { data: verify } = await supabase
      .from("scans")
      .select("restaurant_id")
      .eq("id", data.scan_id)
      .maybeSingle();
    if (verify?.restaurant_id !== data.restaurant_id) {
      throw new Error(
        `Venue did not attach to the scan (wrote ${data.restaurant_id}, row reads ${verify?.restaurant_id ?? "null"}).`,
      );
    }

    // Keep the legacy mirror in step when the caller knows its row.
    if (data.scan_log_id) {
      await supabase
        .from("scan_logs")
        .update({ restaurant_id: data.restaurant_id })
        .eq("id", data.scan_log_id);
    }

    const { data: rows } = await supabase
      .from("scan_wines")
      .select("producer,cuvee,price,price_amount,currency,format,raw_text,matched_bottle_id")
      .eq("scan_id", data.scan_id);

    // Teach the venue its currency only from the scan's own detected value, and
    // only while the column is empty — a venue must not inherit a guess.
    if (!rest.currency && scan.currency) {
      await supabase
        .from("restaurants")
        .update({ currency: scan.currency })
        .eq("id", data.restaurant_id);
    }

    const { captureVenueFacts } = await import("@/lib/venue-capture.server");
    const captured = await captureVenueFacts({
      restaurantId: data.restaurant_id,
      userId,
      scanLogId: data.scan_log_id ?? null,
      scanId: data.scan_id,
      observedAt: (scan.scanned_at as string | null) ?? new Date().toISOString(),
      rows: (rows ?? []) as never,
    });

    return {
      restaurant_id: rest.id as string,
      restaurant_name: rest.name as string,
      wines: captured.edges,
      prices: captured.prices,
    };
  });
