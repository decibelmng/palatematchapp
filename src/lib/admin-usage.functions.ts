// READ-ONLY admin usage analytics. Admin-gated, SELECT-only.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || userId !== adminId) throw new Error("Not authorized");
}

export const adminUsageSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("admin_usage_summary");
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? {
      total_users: 0, active_24h: 0, active_7d: 0, active_30d: 0,
      new_this_week: 0, median_ratings_per_user: 0,
    }) as {
      total_users: number; active_24h: number; active_7d: number; active_30d: number;
      new_this_week: number; median_ratings_per_user: number | null;
    };
  });

export const adminUserList = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number; offset?: number }) => input ?? {})
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("admin_user_list", {
      p_limit: data.limit ?? 500,
      p_offset: data.offset ?? 0,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      id: string; username: string; display_name: string | null;
      created_at: string; last_seen_at: string | null;
      ratings_count: number; scans_count: number; wishlist_count: number;
    }>;
  });

export const adminDailyActiveUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number }) => input ?? {})
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("admin_daily_active_users", {
      p_days: data.days ?? 30,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ day: string; users: number }>;
  });
