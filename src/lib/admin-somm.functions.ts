// ADMIN-ONLY. Somm invite code management (list, generate, revoke) and
// an email-enriched user list. All gated by ADMIN_USER_ID via assertAdmin.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || userId !== adminId) throw new Error("Not authorized");
}

export type SommCodeRow = {
  code: string;
  note: string | null;
  created_at: string;
  used_at: string | null;
  revoked_at: string | null;
  used_by: string | null;
  used_by_username: string | null;
  used_by_display_name: string | null;
  used_by_email: string | null;
  status: "active" | "used" | "revoked";
};

export const adminListSommCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("admin_somm_codes_list" as never);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SommCodeRow[];
  });

export const adminGenerateSommCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { note?: string | null }) => input ?? {})
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("admin_somm_code_generate" as never, {
      p_admin_id: context.userId,
      p_note: data.note ?? null,
    } as never);
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? (rows[0] as { code: string } | undefined) : (rows as { code: string } | undefined);
    return { code: row?.code ?? "" };
  });

export const adminRevokeSommCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { code: string }) => {
    if (!input?.code) throw new Error("code required");
    return input;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ok, error } = await supabaseAdmin.rpc("admin_somm_code_revoke" as never, {
      p_admin_id: context.userId,
      p_code: data.code,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: Boolean(ok) };
  });

export type AdminUserRowWithEmail = {
  id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  created_at: string;
  last_seen_at: string | null;
  ratings_count: number;
  scans_count: number;
  wishlist_count: number;
};

export const adminUserListWithEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number; offset?: number }) => input ?? {})
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("admin_user_list_with_email" as never, {
      p_admin_id: context.userId,
      p_limit: data.limit ?? 500,
      p_offset: data.offset ?? 0,
    } as never);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as AdminUserRowWithEmail[];
  });
