// Friends activity feed — read-only server fn returning friends' recent
// ratings joined with the bottle's fingerprint columns and the friend's
// profile card. Prediction & confidence are computed client-side against
// the viewer's own ratings; this endpoint writes nothing.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type FeedFriend = {
  user_id: string;
  username: string;
  display_name: string | null;
  palate_code_red: string;
  palate_code_white: string;
};

export type FeedBottle = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  grape: string | null;
  vintage: number | null;
  type: string | null;
  price_band: string | null;
  fp_fresh: number | null;
  fp_acid: number | null;
  fp_tannin: number | null;
  fp_fruit_dark: number | null;
  fp_ripe: number | null;
  fp_oak: number | null;
  fp_body: number | null;
  fp_savory: number | null;
  unverified: boolean;
};

export type FeedItem = {
  rating_id: string;
  stars: number;
  note: string | null;
  created_at: string;
  friend: FeedFriend;
  bottle: FeedBottle;
};

const Input = z.object({
  limit: z.number().int().min(1).max(50).default(30),
  before: z.string().datetime().nullable().optional(),
});

export const getFriendsFeed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<FeedItem[]> => {
    const { supabase, userId } = context;

    // Step 1: resolve mutual (accepted) friends both directions.
    const { data: frows, error: fErr } = await supabase
      .from("friendships")
      .select("requester_id, addressee_id, status")
      .eq("status", "accepted");
    if (fErr) throw new Error(fErr.message);
    const friendIds = Array.from(new Set(
      (frows ?? []).map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id)),
    )).filter((id) => id && id !== userId);
    if (friendIds.length === 0) return [];

    // Step 2: recent ratings from those friends, excluding per-rating opt-outs.
    let q = supabase
      .from("ratings")
      .select("id, user_id, bottle_id, stars, note, created_at")
      .in("user_id", friendIds)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.before) q = q.lt("created_at", data.before);
    const { data: rrows, error: rErr } = await q;
    if (rErr) throw new Error(rErr.message);
    let ratings = rrows ?? [];
    if (ratings.length === 0) return [];

    // Hide rating rows the rater flagged as "don't share".
    const ratingIds = ratings.map((r) => r.id);
    const { data: optouts } = await supabase
      .from("rating_share_optout")
      .select("rating_id")
      .in("rating_id", ratingIds);
    const hidden = new Set((optouts ?? []).map((r: any) => r.rating_id));
    if (hidden.size > 0) ratings = ratings.filter((r) => !hidden.has(r.id));
    if (ratings.length === 0) return [];

    const bottleIds = Array.from(new Set(ratings.map((r) => r.bottle_id)));
    const profileIds = Array.from(new Set(ratings.map((r) => r.user_id)));

    const [bres, pres] = await Promise.all([
      supabase
        .from("bottles")
        .select(
          "id, name, producer, region, grape, vintage, type, price_band, fp_fresh, fp_acid, fp_tannin, fp_fruit_dark, fp_ripe, fp_oak, fp_body, fp_savory, unverified",
        )
        .in("id", bottleIds),
      supabase
        .from("profiles")
        .select("id, username, display_name, palate_code_red, palate_code_white")
        .in("id", profileIds),
    ]);
    if (bres.error) throw new Error(bres.error.message);
    if (pres.error) throw new Error(pres.error.message);
    const byBottle = new Map((bres.data ?? []).map((b) => [b.id, b]));
    const byProfile = new Map((pres.data ?? []).map((p) => [p.id, p]));

    const items: FeedItem[] = [];
    for (const r of ratings) {
      const b = byBottle.get(r.bottle_id);
      const p = byProfile.get(r.user_id);
      if (!b || !p) continue;
      items.push({
        rating_id: r.id,
        stars: r.stars,
        note: r.note,
        created_at: r.created_at,
        friend: {
          user_id: p.id,
          username: p.username,
          display_name: p.display_name,
          palate_code_red: p.palate_code_red ?? "·····",
          palate_code_white: p.palate_code_white ?? "·····",
        },
        bottle: {
          id: b.id, name: b.name, producer: b.producer, region: b.region,
          grape: b.grape, vintage: b.vintage, type: b.type, price_band: b.price_band,
          fp_fresh: b.fp_fresh ?? null, fp_acid: b.fp_acid ?? null, fp_tannin: b.fp_tannin ?? null,
          fp_fruit_dark: b.fp_fruit_dark ?? null, fp_ripe: b.fp_ripe ?? null, fp_oak: b.fp_oak ?? null,
          fp_body: b.fp_body ?? null, fp_savory: b.fp_savory ?? null,
          unverified: b.unverified ?? false,
        },
      });
    }
    return items;
  });

// Latest-friend-rating timestamp for the activity dot on the Feed tab.
export const getFeedActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ latest_at: string | null }> => {
    const { supabase, userId } = context;
    const { data: frows } = await supabase
      .from("friendships")
      .select("requester_id, addressee_id")
      .eq("status", "accepted");
    const friendIds = Array.from(new Set(
      (frows ?? []).map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id)),
    )).filter((id) => id && id !== userId);
    if (friendIds.length === 0) return { latest_at: null };
    const { data } = await supabase
      .from("ratings")
      .select("created_at")
      .in("user_id", friendIds)
      .order("created_at", { ascending: false })
      .limit(1);
    return { latest_at: data?.[0]?.created_at ?? null };
  });
