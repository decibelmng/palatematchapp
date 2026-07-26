// User-facing feedback: submit rows scoped to the caller (RLS enforced).
// Also handles signed screenshot URL minting so uploads sit in a private bucket.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const CATEGORIES = ["bug", "confusing", "idea", "love", "other"] as const;
export type FeedbackCategory = (typeof CATEGORIES)[number] | "helpful_prompt";

export type SubmitFeedbackInput = {
  category: FeedbackCategory;
  message?: string | null;
  screen?: string | null;
  screenshot_path?: string | null; // storage object path inside feedback-screenshots
  app_version?: string | null;
  context?: Record<string, unknown> | null;
  source: "button" | "prompt";
  prompt_key?: string | null;
  rating?: "up" | "down" | null;
};

export const submitFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SubmitFeedbackInput) => {
    if (!input || typeof input !== "object") throw new Error("Invalid input");
    const allowed = new Set<FeedbackCategory>([...CATEGORIES, "helpful_prompt"]);
    if (!allowed.has(input.category)) throw new Error("Invalid category");
    if (input.source !== "button" && input.source !== "prompt") throw new Error("Invalid source");
    if (input.rating && input.rating !== "up" && input.rating !== "down") throw new Error("Invalid rating");
    return input;
  })
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const row = {
      user_id: userId,
      category: data.category,
      message: data.message?.trim() || null,
      screen: data.screen?.slice(0, 200) ?? null,
      screenshot_url: data.screenshot_path ?? null,
      app_version: data.app_version ?? null,
      context: (data.context ?? null) as never,
      source: data.source,
      prompt_key: data.prompt_key ?? null,
      rating: data.rating ?? null,
    };
    const { data: inserted, error } = await supabase
      .from("feedback")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: inserted.id };
  });

/** Mint a short-lived signed URL for a private screenshot so admins/owners can view it. */
export const signFeedbackScreenshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) => {
    if (!input?.path) throw new Error("path required");
    return input;
  })
  .handler(async ({ context, data }) => {
    // Owner: use the user's supabase client (RLS lets them read their own path).
    // Admin: verified elsewhere via adminListFeedback which uses supabaseAdmin.
    const { data: signed, error } = await context.supabase.storage
      .from("feedback-screenshots")
      .createSignedUrl(data.path, 60 * 15);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
