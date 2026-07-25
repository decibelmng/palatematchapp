// Admin: capture accumulation dashboard — read-only, admin-gated.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || userId !== adminId) throw new Error("Not authorized");
}

export const adminCaptureSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("admin_capture_summary", { p_min_obs: 5 });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? {
      total_restaurants: 0, total_listings: 0, total_price_obs: 0,
      restaurants_with_min_obs: 0, possible_duplicates: 0, scans_this_week: 0,
    }) as {
      total_restaurants: number; total_listings: number; total_price_obs: number;
      restaurants_with_min_obs: number; possible_duplicates: number; scans_this_week: number;
    };
  });

export const adminRestaurantCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("admin_restaurant_coverage", { p_limit: 500 });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string; name: string; city: string | null;
      possible_duplicate: boolean; venue_raw_text_last: string | null;
      listings: number; price_obs: number;
      first_seen: string | null; last_seen: string | null;
    }>;
  });
