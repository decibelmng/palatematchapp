import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

// -------- Redeem SOMM invite code (Phase B; badge only, no engine weight) --------

export const redeemSommCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      code: z.string().min(3).max(64),
      role: z.enum(["sommelier", "store_owner", "beverage_lead", "other"]).optional(),
      establishment: z.string().max(120).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("redeem_somm_code", {
      p_code: data.code,
      p_role: data.role ?? null,
      p_establishment: data.establishment ?? null,
    } as never);
    if (error) throw new Error(error.message);
    return Array.isArray(rows) ? rows[0] : rows;
  });

// -------- Follows (Phase C) --------

export const followUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ followee_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("follow_user", { p_followee: data.followee_id } as never);
    if (error) throw new Error(error.message);
    return Array.isArray(rows) ? rows[0] : rows;
  });

export const unfollowUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ followee_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("unfollow_user", { p_followee: data.followee_id } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const respondFollow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ follow_id: z.string().uuid(), accept: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("respond_follow", {
      p_follow_id: data.follow_id,
      p_accept: data.accept,
    } as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPendingFollows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("follows")
      .select("id, follower_id, created_at, status")
      .eq("followee_id", context.userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// -------- Public profile (Phase C) — publishable client, no bearer required --------

export const getPublicProfile = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ username: z.string().min(1).max(64) }).parse(input))
  .handler(async ({ data }) => {
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
    const { data: rows, error } = await client.rpc("get_public_profile", { p_username: data.username } as never);
    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return row ?? null;
  });
