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
          palate_code_red: p.palate_code_red ?? "?????",
          palate_code_white: p.palate_code_white ?? "?????",
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

/**
 * The nearby-list join: bottles your friends LOVE (≥4★) that appear on a wine
 * list recently scanned into the app. There is no geolocation in the schema,
 * so "on a list" means a recent parsed venue scan — NOT GPS proximity; the copy
 * must not claim distance.
 *
 * Privacy: reuses the EXACT friend-gate + opt-out filter as getFriendsFeed —
 * only accepted friends' ratings, minus per-rating opt-outs. Never widen this.
 */
export type FriendBottleOnList = {
  bottle: FeedBottle;
  friends: { username: string; display_name: string | null }[];
  venues: string[]; // restaurant names carrying it on a recent list
  friendCount: number;
};

export const getFriendBottlesOnLists = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FriendBottleOnList[]> => {
    const { supabase, userId } = context;

    // 1. Accepted friends, both directions (same gate as getFriendsFeed).
    const { data: frows, error: fErr } = await supabase
      .from("friendships").select("requester_id, addressee_id").eq("status", "accepted");
    if (fErr) throw new Error(fErr.message);
    const friendIds = Array.from(new Set(
      (frows ?? []).map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id)),
    )).filter((id) => id && id !== userId);
    if (friendIds.length === 0) return [];

    // 2. Friends' LOVED bottles (≥4★), minus per-rating opt-outs.
    const { data: rrows, error: rErr } = await supabase
      .from("ratings").select("id, user_id, bottle_id, stars").in("user_id", friendIds).gte("stars", 4);
    if (rErr) throw new Error(rErr.message);
    let loved = rrows ?? [];
    if (loved.length === 0) return [];
    const { data: optouts } = await supabase
      .from("rating_share_optout").select("rating_id").in("rating_id", loved.map((r) => r.id));
    const hidden = new Set((optouts ?? []).map((r: any) => r.rating_id));
    loved = loved.filter((r) => !hidden.has(r.id));
    if (loved.length === 0) return [];

    const loversByBottle = new Map<string, Set<string>>();
    for (const r of loved) {
      const s = loversByBottle.get(r.bottle_id) ?? new Set<string>();
      s.add(r.user_id); loversByBottle.set(r.bottle_id, s);
    }
    const lovedBottleIds = Array.from(loversByBottle.keys());

    // 3. Which loved bottles appear on a recently-scanned venue list.
    const { data: recentScans } = await supabase
      .from("scans").select("id, restaurant_id, scanned_at")
      .eq("kind", "list").eq("status", "parsed").not("restaurant_id", "is", null)
      .order("scanned_at", { ascending: false }).limit(300);
    const scanRest = new Map((recentScans ?? []).map((s) => [s.id, s.restaurant_id as string]));
    if (scanRest.size === 0) return [];
    const { data: sw } = await supabase
      .from("scan_wines").select("scan_id, matched_bottle_id")
      .in("scan_id", Array.from(scanRest.keys())).in("matched_bottle_id", lovedBottleIds);
    const venuesByBottle = new Map<string, Set<string>>();
    for (const w of sw ?? []) {
      const bid = w.matched_bottle_id as string | null;
      const rid = scanRest.get(w.scan_id as string);
      if (!bid || !rid) continue;
      const s = venuesByBottle.get(bid) ?? new Set<string>();
      s.add(rid); venuesByBottle.set(bid, s);
    }
    const hitBottleIds = Array.from(venuesByBottle.keys());
    if (hitBottleIds.length === 0) return [];

    // 4. Hydrate bottles, friend profiles, restaurant names.
    const restIds = Array.from(new Set(Array.from(venuesByBottle.values()).flatMap((s) => Array.from(s))));
    const [bres, pres, rres] = await Promise.all([
      supabase.from("bottles").select(
        "id, name, producer, region, grape, vintage, type, price_band, fp_fresh, fp_acid, fp_tannin, fp_fruit_dark, fp_ripe, fp_oak, fp_body, fp_savory, unverified",
      ).in("id", hitBottleIds),
      supabase.from("profiles").select("id, username, display_name").in("id", Array.from(new Set(loved.map((r) => r.user_id)))),
      supabase.from("restaurants").select("id, name").in("id", restIds),
    ]);
    const byBottle = new Map((bres.data ?? []).map((b) => [b.id, b]));
    const byProfile = new Map((pres.data ?? []).map((p) => [p.id, p]));
    const byRest = new Map((rres.data ?? []).map((r) => [r.id, r.name as string]));

    const out: FriendBottleOnList[] = [];
    for (const bid of hitBottleIds) {
      const b = byBottle.get(bid);
      if (!b) continue;
      const friends = Array.from(loversByBottle.get(bid) ?? [])
        .map((id) => byProfile.get(id)).filter(Boolean)
        .map((p: any) => ({ username: p.username as string, display_name: p.display_name as string | null }));
      const venues = Array.from(venuesByBottle.get(bid) ?? [])
        .map((rid) => byRest.get(rid)).filter(Boolean) as string[];
      if (friends.length === 0 || venues.length === 0) continue;
      out.push({
        bottle: {
          id: b.id, name: b.name, producer: b.producer, region: b.region,
          grape: b.grape, vintage: b.vintage, type: b.type, price_band: b.price_band,
          fp_fresh: b.fp_fresh ?? null, fp_acid: b.fp_acid ?? null, fp_tannin: b.fp_tannin ?? null,
          fp_fruit_dark: b.fp_fruit_dark ?? null, fp_ripe: b.fp_ripe ?? null, fp_oak: b.fp_oak ?? null,
          fp_body: b.fp_body ?? null, fp_savory: b.fp_savory ?? null,
          unverified: b.unverified ?? false,
        },
        friends, venues, friendCount: friends.length,
      });
    }
    out.sort((a, b) => b.friendCount - a.friendCount || b.venues.length - a.venues.length);
    return out.slice(0, 10);
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
