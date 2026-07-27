import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AdminAuthAuditEntry = {
  id: string;
  created_at: string;
  ip_address: string | null;
  action: string | null;
  method: string | null;
  path: string | null;
  provider: string | null;
  status: string | null;
  error: string | null;
  payload: string | null;
};

export const adminAuthAuditEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { hours?: number; limit?: number } | undefined) => ({
    hours: Math.min(Math.max(Number(input?.hours ?? 72), 1), 168),
    limit: Math.min(Math.max(Number(input?.limit ?? 300), 1), 1000),
  }))
  .handler(async ({ context, data }) => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role" as never, {
      _user_id: context.userId,
      _role: "admin",
    } as never);
    if (roleError || isAdmin !== true) throw new Error("Not authorized");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.hours * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabaseAdmin.rpc("admin_auth_audit_entries" as never, {
      p_since: since,
      p_limit: data.limit,
    } as never);
    if (error) throw new Error(error.message);
    return ((rows ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ""),
      created_at: String(row.created_at ?? ""),
      ip_address: typeof row.ip_address === "string" ? row.ip_address : null,
      action: typeof row.action === "string" ? row.action : null,
      method: typeof row.method === "string" ? row.method : null,
      path: typeof row.path === "string" ? row.path : null,
      provider: typeof row.provider === "string" ? row.provider : null,
      status: typeof row.status === "string" ? row.status : null,
      error: typeof row.error === "string" ? row.error : null,
      payload: row.payload ? JSON.stringify(row.payload) : null,
    })) satisfies AdminAuthAuditEntry[];
  });