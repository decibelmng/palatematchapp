import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type InviteInfo = {
  token: string;
  kind: "friend" | "scan";
  inviter_id: string;
  inviter_username: string;
  inviter_display_name: string | null;
  inviter_palate_code_red: string;
  inviter_palate_code_white: string;
  inviter_avatar_url: string | null;
  scan_share_token: string | null;
  scan_venue: string | null;
  redeemed: boolean;
};

function randomToken(): string {
  // 22-char base64url of 16 random bytes — non-guessable.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Create or reuse an invite for the current user.
 *  - kind='friend' → one per user (reused across shares).
 *  - kind='scan'   → one per scan.
 */
export const createOrGetInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      kind: z.enum(["friend", "scan"]),
      scan_id: z.string().uuid().optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ token: string }> => {
    const { supabase, userId } = context;

    if (data.kind === "friend") {
      const { data: existing } = await supabase
        .from("invites")
        .select("token")
        .eq("inviter_id", userId)
        .eq("kind", "friend")
        .maybeSingle();
      if (existing?.token) return { token: existing.token };
    } else {
      if (!data.scan_id) throw new Error("scan_id required for scan invites");
      const { data: existing } = await supabase
        .from("invites")
        .select("token, inviter_id")
        .eq("scan_id", data.scan_id)
        .maybeSingle();
      if (existing?.token) return { token: existing.token };
    }

    const token = randomToken();
    const { error } = await supabase.from("invites").insert({
      token,
      inviter_id: userId,
      kind: data.kind,
      scan_id: data.kind === "scan" ? data.scan_id ?? null : null,
    });
    if (error) throw new Error(error.message);
    return { token };
  });

/** Public: read invite by token (works signed-out). */
export const getInvite = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(1).max(128) }).parse(input))
  .handler(async ({ data }): Promise<InviteInfo | null> => {
    const url = process.env.SUPABASE_URL!;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data: rows, error } = await client.rpc("get_invite", { p_token: data.token } as never);
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return (row as InviteInfo | null) ?? null;
  });

/** Auth: redeem invite — creates auto-accepted friendship with inviter. */
export const redeemInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ token: z.string().min(1).max(128) }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("redeem_invite", { p_token: data.token } as never);
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row as { kind: "friend" | "scan"; inviter_id: string; scan_share_token: string | null } | null;
  });
