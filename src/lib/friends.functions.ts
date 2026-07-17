import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// -------- Types shared with the client --------

export type FriendProfile = {
  user_id: string;
  username: string;
  display_name: string | null;
  palate_code_red: string;
  palate_code_white: string;
};

export type FriendshipRow = {
  id: string;
  status: "pending" | "accepted" | "declined" | "blocked";
  requester_id: string;
  addressee_id: string;
  created_at: string;
  responded_at: string | null;
  other: {
    user_id: string;
    username: string;
    display_name: string | null;
    palate_code_red: string;
    palate_code_white: string;
  };
  direction: "incoming" | "outgoing";
};

export type SearchUserHit = {
  user_id: string;
  username: string;
  display_name: string | null;
};

// -------- User search --------

export const searchUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ q: z.string().min(1).max(60) }).parse(input))
  .handler(async ({ data, context }): Promise<SearchUserHit[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase.rpc("search_users", {
      q: data.q.trim(),
      lim: 10,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as SearchUserHit[];
  });

// -------- List my friendships (accepted + pending, both directions) --------

export const listFriendships = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FriendshipRow[]> => {
    const { supabase, userId } = context;
    const { data: rows, error } = await supabase
      .from("friendships")
      .select("id, status, requester_id, addressee_id, created_at, responded_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const otherIds = Array.from(
      new Set((rows ?? []).map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id))),
    );
    if (otherIds.length === 0) return [];

    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, username, display_name, palate_code_red, palate_code_white")
      .in("id", otherIds);
    if (pErr) throw new Error(pErr.message);
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));

    return (rows ?? []).map((r) => {
      const otherId = r.requester_id === userId ? r.addressee_id : r.requester_id;
      const p = byId.get(otherId);
      return {
        ...r,
        status: r.status as FriendshipRow["status"],
        direction: r.requester_id === userId ? "outgoing" : "incoming",
        other: {
          user_id: otherId,
          username: p?.username ?? "unknown",
          display_name: p?.display_name ?? null,
          palate_code_red: p?.palate_code_red ?? "·····",
          palate_code_white: p?.palate_code_white ?? "·····",
        },
      };
    });
  });

// -------- Send friend request (accepts either user_id or username) --------

export const sendFriendRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ user_id: z.string().uuid().optional(), username: z.string().min(1).optional() })
      .refine((v) => v.user_id || v.username, "user_id or username required")
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let targetId = data.user_id ?? null;
    if (!targetId && data.username) {
      const { data: resolvedId, error } = await supabase.rpc("resolve_username_to_id", {
        p_username: data.username.trim().toLowerCase(),
      });
      if (error) throw new Error(error.message);
      if (!resolvedId) throw new Error("No user with that username.");
      targetId = resolvedId as string;
    }
    if (!targetId) throw new Error("Missing target user.");
    if (targetId === userId) throw new Error("You can't friend yourself.");

    // If a friendship already exists in either direction, surface a friendly message.
    const { data: existing } = await supabase
      .from("friendships")
      .select("id, status, requester_id, addressee_id")
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${userId})`,
      )
      .maybeSingle();

    if (existing) {
      if (existing.status === "accepted") return { ok: true, status: "already-friends" as const };
      if (existing.status === "pending") return { ok: true, status: "already-pending" as const };
      // declined/blocked → resend by updating back to pending if the current user is the requester
      if (existing.requester_id === userId) {
        const { error: uErr } = await supabase
          .from("friendships")
          .update({ status: "pending", responded_at: null })
          .eq("id", existing.id);
        if (uErr) throw new Error(uErr.message);
        return { ok: true, status: "resent" as const };
      }
      throw new Error("Can't send a request to this user right now.");
    }

    const { error: iErr } = await supabase
      .from("friendships")
      .insert({ requester_id: userId, addressee_id: targetId, status: "pending" });
    if (iErr) throw new Error(iErr.message);
    return { ok: true, status: "sent" as const };
  });

// -------- Respond to / cancel / remove a friendship --------

export const respondToFriendship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      action: z.enum(["accept", "decline", "cancel", "remove"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Friendship not found.");

    const isRequester = row.requester_id === userId;
    const isAddressee = row.addressee_id === userId;
    if (!isRequester && !isAddressee) throw new Error("Not your friendship.");

    switch (data.action) {
      case "accept": {
        if (!isAddressee) throw new Error("Only the recipient can accept.");
        const { error: uErr } = await supabase
          .from("friendships")
          .update({ status: "accepted", responded_at: new Date().toISOString() })
          .eq("id", row.id);
        if (uErr) throw new Error(uErr.message);
        return { ok: true };
      }
      case "decline": {
        if (!isAddressee) throw new Error("Only the recipient can decline.");
        const { error: uErr } = await supabase
          .from("friendships")
          .update({ status: "declined", responded_at: new Date().toISOString() })
          .eq("id", row.id);
        if (uErr) throw new Error(uErr.message);
        return { ok: true };
      }
      case "cancel":
      case "remove": {
        // Either party can remove/cancel. Delete row so a fresh request can be sent later.
        const { error: dErr } = await supabase.from("friendships").delete().eq("id", row.id);
        if (dErr) throw new Error(dErr.message);
        return { ok: true };
      }
    }
  });

// -------- Update my own username / display_name --------

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      username: z.string().regex(/^[a-z0-9_]{3,24}$/i).optional(),
      display_name: z.string().max(60).optional(),
      onboarding_stage: z.enum(["intro", "rate5", "done"]).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: { username?: string; display_name?: string; onboarding_stage?: string } = {};
    if (data.username !== undefined) patch.username = data.username.toLowerCase();
    if (data.display_name !== undefined) patch.display_name = data.display_name;
    if (data.onboarding_stage !== undefined) patch.onboarding_stage = data.onboarding_stage;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (error) {
      if (error.code === "23505") throw new Error("That username is already taken.");
      throw new Error(error.message);
    }
    return { ok: true };
  });

// -------- Get my own profile (username, display_name, recent_groups) --------

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, palate_code_red, palate_code_white, n_rated, recent_groups, onboarding_stage")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

// -------- Recent drinking groups (persisted on the profile) --------

export type RecentGroup = { ids: string[]; label: string; usedAt: number };

const RecentGroupSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(6),
  label: z.string().min(1).max(120),
  usedAt: z.number().int().positive(),
});

export const saveRecentGroupFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(6), label: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<RecentGroup[]> => {
    const { supabase, userId } = context;
    const { data: prof, error: rErr } = await supabase
      .from("profiles").select("recent_groups").eq("id", userId).maybeSingle();
    if (rErr) throw new Error(rErr.message);

    const existing: RecentGroup[] = Array.isArray(prof?.recent_groups)
      ? (prof!.recent_groups as unknown[]).flatMap((g) => {
          const parsed = RecentGroupSchema.safeParse(g);
          return parsed.success ? [parsed.data] : [];
        })
      : [];

    const key = [...data.ids].sort().join(",");
    const dedup = existing.filter((g) => [...g.ids].sort().join(",") !== key);
    const next: RecentGroup[] = [
      { ids: data.ids, label: data.label, usedAt: Date.now() },
      ...dedup,
    ].slice(0, 5);

    const { error: uErr } = await supabase
      .from("profiles").update({ recent_groups: next }).eq("id", userId);
    if (uErr) throw new Error(uErr.message);
    return next;
  });

