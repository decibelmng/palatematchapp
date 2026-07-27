import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(context: { supabase: { rpc: Function }; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role" as never, {
    _user_id: context.userId,
    _role: "admin",
  } as never);
  if (error || data !== true) throw new Error("Not authorized");
}

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
  payload: Record<string, unknown> | null;
};

export const adminAuthAuditEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { hours?: number; limit?: number } | undefined) => ({
    hours: Math.min(Math.max(Number(input?.hours ?? 72), 1), 168),
    limit: Math.min(Math.max(Number(input?.limit ?? 300), 1), 1000),
  }))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.hours * 60 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabaseAdmin.rpc("admin_auth_audit_entries" as never, {
      p_since: since,
      p_limit: data.limit,
    } as never);
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as AdminAuthAuditEntry[];
  });