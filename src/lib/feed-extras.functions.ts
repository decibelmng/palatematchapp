// Extra feed sources + restaurant objects.
//
//   getMyActivity()          — the viewer's own ratings (with benchmark tier
//                              and bottle-label photo where one exists).
//   getSharedLists()         — list scans: the viewer's own, plus friends'
//                              explicitly shared ones (share_token present).
//   setRatingPhoto()         — attach / detach a label photo on own rating.
//   listSavedRestaurants()   — the "Want to go" list.
//   toggleSavedRestaurant()  — one-tap save from any venue card.
//
// Everything writes only the caller's own rows. Friends' scans are read with
// the admin client ONLY after mutual friendship + an explicit share token are
// verified against the RLS client.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { FeedBottle } from "./feed.functions";

const BOTTLE_COLS =
  "id, name, producer, region, grape, vintage, type, price_band, fp_fresh, fp_acid, fp_tannin, fp_fruit_dark, fp_ripe, fp_oak, fp_body, fp_savory, unverified";

function toFeedBottle(b: any): FeedBottle {
  return {
    id: b.id, name: b.name, producer: b.producer, region: b.region,
    grape: b.grape, vintage: b.vintage, type: b.type, price_band: b.price_band,
    fp_fresh: b.fp_fresh ?? null, fp_acid: b.fp_acid ?? null, fp_tannin: b.fp_tannin ?? null,
    fp_fruit_dark: b.fp_fruit_dark ?? null, fp_ripe: b.fp_ripe ?? null, fp_oak: b.fp_oak ?? null,
    fp_body: b.fp_body ?? null, fp_savory: b.fp_savory ?? null,
    unverified: b.unverified ?? false,
  };
}

// ---------------------------------------------------------------
// Own activity
// ---------------------------------------------------------------

export type OwnActivityItem = {
  rating_id: string;
  stars: number;
  note: string | null;
  created_at: string;
  bottle: FeedBottle;
  tier: "canon" | "nemesis" | null;
  photo_url: string | null;
  has_photo: boolean;
};

const OwnInput = z.object({ limit: z.number().int().min(1).max(50).default(20) });

export const getMyActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => OwnInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<OwnActivityItem[]> => {
    const { supabase, userId } = context;

    const { data: rows, error } = await supabase
      .from("ratings")
      .select("id, bottle_id, stars, note, created_at, photo_path")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    const ratings = (rows ?? []) as any[];
    if (ratings.length === 0) return [];

    const bottleIds = Array.from(new Set(ratings.map((r) => r.bottle_id)));
    const [bres, cres] = await Promise.all([
      supabase.from("bottles").select(BOTTLE_COLS).in("id", bottleIds),
      supabase
        .from("canon_wines")
        .select("bottle_id, tier, replaced_at")
        .eq("user_id", userId)
        .is("replaced_at", null),
    ]);
    if (bres.error) throw new Error(bres.error.message);
    const byBottle = new Map((bres.data ?? []).map((b: any) => [b.id, b]));
    const tierBy = new Map(
      ((cres.data ?? []) as any[]).map((c) => [c.bottle_id, c.tier as "canon" | "nemesis"]),
    );

    // Own photos live under the caller's own folder — RLS-signable.
    const paths = ratings.map((r) => r.photo_path).filter((p): p is string => !!p);
    const urlByPath = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage
        .from("scan-images")
        .createSignedUrls(paths, 60 * 60);
      for (const s of (signed ?? []) as any[]) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl);
      }
    }

    const out: OwnActivityItem[] = [];
    for (const r of ratings) {
      const b = byBottle.get(r.bottle_id);
      if (!b) continue;
      out.push({
        rating_id: r.id,
        stars: r.stars,
        note: r.note,
        created_at: r.created_at,
        bottle: toFeedBottle(b),
        tier: tierBy.get(r.bottle_id) ?? null,
        photo_url: r.photo_path ? urlByPath.get(r.photo_path) ?? null : null,
        has_photo: !!r.photo_path,
      });
    }
    return out;
  });

// ---------------------------------------------------------------
// Shared / own list scans
// ---------------------------------------------------------------

export type SharedListItem = {
  scan_id: string;
  scanned_at: string;
  mine: boolean;
  wine_count: number;
  restaurant: {
    id: string;
    name: string;
    city: string | null;
    neighborhood: string | null;
    phone: string | null;
    reservation_url: string | null;
  } | null;
  sharer: { user_id: string; username: string; display_name: string | null } | null;
};

const SharedInput = z.object({ limit: z.number().int().min(1).max(30).default(10) });

export const getSharedLists = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SharedInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<SharedListItem[]> => {
    const { supabase, userId } = context;

    // Own list scans (RLS-visible).
    const { data: own } = await supabase
      .from("scans")
      .select("id, user_id, restaurant_id, scanned_at")
      .eq("kind", "list")
      .eq("status", "parsed")
      .eq("user_id", userId)
      .order("scanned_at", { ascending: false })
      .limit(data.limit);

    // Mutual friends.
    const { data: frows } = await supabase
      .from("friendships")
      .select("requester_id, addressee_id, status")
      .eq("status", "accepted");
    const friendIds = Array.from(new Set(
      (frows ?? []).map((r) => (r.requester_id === userId ? r.addressee_id : r.requester_id)),
    )).filter((id) => id && id !== userId) as string[];

    let shared: any[] = [];
    const admin = friendIds.length > 0
      ? (await import("@/integrations/supabase/client.server")).supabaseAdmin
      : null;
    if (admin) {
      const { data: rows } = await admin
        .from("scans")
        .select("id, user_id, restaurant_id, scanned_at, share_token")
        .eq("kind", "list")
        .eq("status", "parsed")
        .in("user_id", friendIds)
        .not("share_token", "is", null)
        .order("scanned_at", { ascending: false })
        .limit(data.limit);
      shared = (rows ?? []) as any[];
    }

    const all = [
      ...(((own ?? []) as any[]).map((s) => ({ ...s, mine: true }))),
      ...shared.map((s) => ({ ...s, mine: false })),
    ].sort((a, b) => String(b.scanned_at).localeCompare(String(a.scanned_at)))
      .slice(0, data.limit);
    if (all.length === 0) return [];

    const reader = admin ?? supabase;
    const scanIds = all.map((s) => s.id);
    const restIds = Array.from(new Set(all.map((s) => s.restaurant_id).filter(Boolean))) as string[];
    const sharerIds = Array.from(new Set(all.filter((s) => !s.mine).map((s) => s.user_id))) as string[];

    const [{ data: wineRows }, rests, sharers] = await Promise.all([
      reader.from("scan_wines").select("scan_id").in("scan_id", scanIds),
      restIds.length
        ? supabase
            .from("restaurants")
            .select("id, name, city, neighborhood, phone, reservation_url")
            .in("id", restIds)
        : Promise.resolve({ data: [] as any[] }),
      sharerIds.length
        ? supabase.from("profiles").select("id, username, display_name").in("id", sharerIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const counts = new Map<string, number>();
    for (const w of ((wineRows ?? []) as any[])) {
      counts.set(w.scan_id, (counts.get(w.scan_id) ?? 0) + 1);
    }
    const restById = new Map(((rests.data ?? []) as any[]).map((r) => [r.id, r]));
    const profById = new Map(((sharers.data ?? []) as any[]).map((p) => [p.id, p]));

    return all.map((s): SharedListItem => {
      const r = s.restaurant_id ? restById.get(s.restaurant_id) : null;
      const p = s.mine ? null : profById.get(s.user_id);
      return {
        scan_id: s.id,
        scanned_at: s.scanned_at,
        mine: !!s.mine,
        wine_count: counts.get(s.id) ?? 0,
        restaurant: r
          ? {
              id: r.id, name: r.name, city: r.city ?? null,
              neighborhood: r.neighborhood ?? null,
              phone: r.phone ?? null, reservation_url: r.reservation_url ?? null,
            }
          : null,
        sharer: p ? { user_id: p.id, username: p.username, display_name: p.display_name } : null,
      };
    });
  });

// ---------------------------------------------------------------
// Rating photos
// ---------------------------------------------------------------

const PhotoInput = z.object({
  rating_id: z.string().uuid(),
  path: z.string().min(1).nullable(),
  shared: z.boolean().optional(),
});

export const setRatingPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => PhotoInput.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: Record<string, unknown> = { photo_path: data.path };
    if (data.shared !== undefined) patch.photo_shared = data.shared;
    const { error } = await supabase
      .from("ratings")
      .update(patch as never)
      .eq("id", data.rating_id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------------------------------------------------------
// "Want to go" — saved restaurants
// ---------------------------------------------------------------

export type SavedRestaurant = {
  restaurant_id: string;
  name: string;
  city: string | null;
  neighborhood: string | null;
  phone: string | null;
  reservation_url: string | null;
  saved_at: string;
  latest_scan_id: string | null;
};

export const listSavedRestaurants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SavedRestaurant[]> => {
    const { supabase, userId } = context;
    const { data: saves, error } = await supabase
      .from("restaurant_saves")
      .select("restaurant_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (saves ?? []) as any[];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.restaurant_id);
    const [{ data: rests }, { data: scans }] = await Promise.all([
      supabase
        .from("restaurants")
        .select("id, name, city, neighborhood, phone, reservation_url")
        .in("id", ids),
      supabase
        .from("scans")
        .select("id, restaurant_id, scanned_at")
        .in("restaurant_id", ids)
        .eq("kind", "list")
        .eq("status", "parsed")
        .order("scanned_at", { ascending: false }),
    ]);
    const restById = new Map(((rests ?? []) as any[]).map((r) => [r.id, r]));
    const scanBy = new Map<string, string>();
    for (const s of ((scans ?? []) as any[])) {
      if (s.restaurant_id && !scanBy.has(s.restaurant_id)) scanBy.set(s.restaurant_id, s.id);
    }

    const out: SavedRestaurant[] = [];
    for (const r of rows) {
      const rest = restById.get(r.restaurant_id);
      if (!rest) continue;
      out.push({
        restaurant_id: rest.id,
        name: rest.name,
        city: rest.city ?? null,
        neighborhood: rest.neighborhood ?? null,
        phone: rest.phone ?? null,
        reservation_url: rest.reservation_url ?? null,
        saved_at: r.created_at,
        latest_scan_id: scanBy.get(rest.id) ?? null,
      });
    }
    return out;
  });

const ToggleSave = z.object({ restaurant_id: z.string().uuid(), saved: z.boolean() });

export const toggleSavedRestaurant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ToggleSave.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.saved) {
      const { error } = await supabase
        .from("restaurant_saves")
        .upsert(
          { user_id: userId, restaurant_id: data.restaurant_id } as never,
          { onConflict: "user_id,restaurant_id" },
        );
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("restaurant_saves")
        .delete()
        .eq("user_id", userId)
        .eq("restaurant_id", data.restaurant_id);
      if (error) throw new Error(error.message);
    }
    return { ok: true, saved: data.saved };
  });
