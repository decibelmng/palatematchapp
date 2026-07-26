// READ-only admin feedback panel + status writes. Admin-gated via env var.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || userId !== adminId) throw new Error("Not authorized");
}

export type FeedbackRow = {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  category: string;
  message: string | null;
  screen: string | null;
  screenshot_url: string | null;
  signed_screenshot_url: string | null;
  app_version: string | null;
  context: Record<string, unknown> | null | any;
  source: "button" | "prompt";
  prompt_key: string | null;
  rating: "up" | "down" | null;
  status: "new" | "triaged" | "resolved";
  created_at: string;
};

export type FeedbackFilters = {
  category?: string | null;
  source?: "button" | "prompt" | null;
  status?: "new" | "triaged" | "resolved" | null;
  limit?: number;
};

export const adminListFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FeedbackFilters) => input ?? {})
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.min(data.limit ?? 300, 1000));
    if (data.category) q = q.eq("category", data.category);
    if (data.source) q = q.eq("source", data.source);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id).filter(Boolean)));
    let profileMap = new Map<string, { username: string | null; display_name: string | null }>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, username, display_name")
        .in("id", userIds);
      profileMap = new Map((profs ?? []).map((p) => [p.id, { username: p.username, display_name: p.display_name }]));
    }

    // Sign screenshot paths (paths live in a private bucket).
    const signed = await Promise.all(
      (rows ?? []).map(async (r) => {
        let signedUrl: string | null = null;
        if (r.screenshot_url) {
          const { data: s } = await supabaseAdmin.storage
            .from("feedback-screenshots")
            .createSignedUrl(r.screenshot_url, 60 * 60);
          signedUrl = s?.signedUrl ?? null;
        }
        const prof = profileMap.get(r.user_id) ?? { username: null, display_name: null };
        return {
          ...r,
          username: prof.username,
          display_name: prof.display_name,
          signed_screenshot_url: signedUrl,
        } as FeedbackRow;
      }),
    );
    return signed;
  });

export type FeedbackSummary = {
  by_category: Array<{ category: string; n: number }>;
  by_status: Array<{ status: string; n: number }>;
  prompt_ratios: Array<{ prompt_key: string; up: number; down: number }>;
  confusing_by_screen: Array<{ screen: string; n: number }>;
  this_week_total: number;
};

export const adminFeedbackSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: rows, error } = await supabaseAdmin
      .from("feedback")
      .select("category, status, prompt_key, rating, screen, created_at")
      .gte("created_at", weekAgo);
    if (error) throw new Error(error.message);

    const cat = new Map<string, number>();
    const stat = new Map<string, number>();
    const prompts = new Map<string, { up: number; down: number }>();
    const confusing = new Map<string, number>();
    let total = 0;
    for (const r of rows ?? []) {
      total++;
      cat.set(r.category, (cat.get(r.category) ?? 0) + 1);
      stat.set(r.status, (stat.get(r.status) ?? 0) + 1);
      if (r.prompt_key && r.rating) {
        const cur = prompts.get(r.prompt_key) ?? { up: 0, down: 0 };
        if (r.rating === "up") cur.up++; else cur.down++;
        prompts.set(r.prompt_key, cur);
      }
      if (r.category === "confusing" && r.screen) {
        confusing.set(r.screen, (confusing.get(r.screen) ?? 0) + 1);
      }
    }
    return {
      by_category: [...cat].map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n),
      by_status: [...stat].map(([status, n]) => ({ status, n })),
      prompt_ratios: [...prompts].map(([prompt_key, v]) => ({ prompt_key, ...v })),
      confusing_by_screen: [...confusing].map(([screen, n]) => ({ screen, n })).sort((a, b) => b.n - a.n).slice(0, 20),
      this_week_total: total,
    } satisfies FeedbackSummary;
  });

export const adminSetFeedbackStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "new" | "triaged" | "resolved" }) => {
    if (!input?.id) throw new Error("id required");
    if (!["new", "triaged", "resolved"].includes(input.status)) throw new Error("bad status");
    return input;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("feedback")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
