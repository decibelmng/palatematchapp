// READ-ONLY admin data inspector server functions.
// Every handler here is SELECT-only: it either calls the two service-role
// helper RPCs (admin_table_list / admin_table_columns) or uses
// supabaseAdmin.from(...).select(...). No INSERT/UPDATE/DELETE/DDL exists in
// this feature's code path.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || userId !== adminId) throw new Error("Not authorized");
}

export const adminListTables = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tables, error } = await supabaseAdmin.rpc("admin_table_list");
    if (error) throw new Error(error.message);
    const names = ((tables ?? []) as { table_name: string }[]).map((r) => r.table_name);
    const counts: { table_name: string; row_count: number | null }[] = [];
    for (const name of names) {
      const { count, error: cErr } = await supabaseAdmin
        .from(name as any)
        .select("*", { count: "exact", head: true });
      counts.push({ table_name: name, row_count: cErr ? null : count ?? 0 });
    }
    return counts;
  });

export const adminGetColumns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { table: string }) => {
    if (!input || typeof input.table !== "string" || !/^[a-z_][a-z0-9_]*$/i.test(input.table)) {
      throw new Error("Invalid table name");
    }
    return input;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: cols, error } = await supabaseAdmin.rpc("admin_table_columns", {
      p_table: data.table,
    });
    if (error) throw new Error(error.message);
    return (cols ?? []) as { column_name: string; data_type: string; is_nullable: string }[];
  });

export const adminGetRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { table: string; limit?: number }) => {
    if (!input || typeof input.table !== "string" || !/^[a-z_][a-z0-9_]*$/i.test(input.table)) {
      throw new Error("Invalid table name");
    }
    const limit = Math.min(Math.max(Number(input.limit ?? 100) | 0, 1), 500);
    return { table: input.table, limit };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Confirm the requested table is a real public table before selecting.
    const { data: allowed, error: lErr } = await supabaseAdmin.rpc("admin_table_list");
    if (lErr) throw new Error(lErr.message);
    const ok = ((allowed ?? []) as { table_name: string }[]).some((r) => r.table_name === data.table);
    if (!ok) throw new Error("Unknown table");
    const { data: rows, error } = await supabaseAdmin
      .from(data.table as any)
      .select("*")
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
