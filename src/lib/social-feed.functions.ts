// Venue activity feed (no consent), rating opt-outs, palate-overlap
// suggestions, and founder account lookup. All read-only or user-owned
// writes — nothing here writes another user's data.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------------------------------------------------------
// Venue activity — 2A
// ---------------------------------------------------------------
//
// A scanned wine list is a fact about a restaurant. We aggregate by
// (restaurant_id, day) so two scans of one list on one night collapse
// into one item, and enforce an attribution floor (>= MIN_WINES wines
// for that day) so a scan can't be traced back to a single scanner.

const MIN_WINES_FOR_ATTRIBUTION = 8;

export type VenueActivityItem = {
  restaurant_id: string;
  restaurant_name: string;
  city: string | null;
  neighborhood: string | null;
  phone: string | null;
  reservation_url: string | null;
  scanned_day: string; // YYYY-MM-DD (UTC)
  latest_scan_id: string;
  wine_count: number;
  delta: "first-time" | "updated" | { newSince: number };
};

const VenueInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
});

export const getVenueActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => VenueInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<VenueActivityItem[]> => {
    const { supabase } = context;

    // Recent parsed list-scans with a restaurant.
    const { data: recent, error } = await supabase
      .from("scans")
      .select("id, restaurant_id, scanned_at")
      .eq("kind", "list")
      .eq("status", "parsed")
      .not("restaurant_id", "is", null)
      .order("scanned_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    const rows = (recent ?? []).filter((r) => !!r.restaurant_id);
    if (rows.length === 0) return [];

    // Wine counts per scan.
    const scanIds = rows.map((r) => r.id);
    const { data: wineCounts } = await supabase
      .from("scan_wines")
      .select("scan_id, matched_bottle_id")
      .in("scan_id", scanIds);
    const perScan = new Map<string, { total: number; matchedBottleIds: Set<string> }>();
    for (const w of (wineCounts as any[]) ?? []) {
      const c = perScan.get(w.scan_id) ?? { total: 0, matchedBottleIds: new Set<string>() };
      c.total += 1;
      if (w.matched_bottle_id) c.matchedBottleIds.add(w.matched_bottle_id);
      perScan.set(w.scan_id, c);
    }

    // Group by (restaurant_id, day). Keep the LATEST scan per group as
    // the anchor. Under the attribution floor → drop.
    type Group = { restaurantId: string; day: string; latestScanId: string; latestAt: string; wines: number; matched: Set<string> };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const day = (r.scanned_at as string).slice(0, 10);
      const key = `${r.restaurant_id}|${day}`;
      const c = perScan.get(r.id) ?? { total: 0, matchedBottleIds: new Set<string>() };
      const g = groups.get(key);
      if (!g) {
        groups.set(key, {
          restaurantId: r.restaurant_id!, day,
          latestScanId: r.id, latestAt: r.scanned_at as string,
          wines: c.total, matched: new Set(c.matchedBottleIds),
        });
      } else {
        g.wines += c.total;
        c.matchedBottleIds.forEach((id) => g.matched.add(id));
        if ((r.scanned_at as string) > g.latestAt) {
          g.latestAt = r.scanned_at as string; g.latestScanId = r.id;
        }
      }
    }
    const eligible = Array.from(groups.values()).filter((g) => g.wines >= MIN_WINES_FOR_ATTRIBUTION);
    if (eligible.length === 0) return [];

    // Compute delta by comparing each group's matched bottle set with
    // the venue's previous parsed scan (older than this day).
    const restaurantIds = Array.from(new Set(eligible.map((g) => g.restaurantId)));
    const { data: rests } = await supabase
      .from("restaurants")
      .select("id, name, city, neighborhood, phone, reservation_url")
      .in("id", restaurantIds);
    const restById = new Map((rests ?? []).map((r) => [r.id, r]));

    const items: VenueActivityItem[] = [];
    for (const g of eligible) {
      const rest = restById.get(g.restaurantId);
      if (!rest) continue;

      // Prior scan for this restaurant.
      const { data: prior } = await supabase
        .from("scans")
        .select("id")
        .eq("kind", "list")
        .eq("status", "parsed")
        .eq("restaurant_id", g.restaurantId)
        .lt("scanned_at", `${g.day}T00:00:00Z`)
        .order("scanned_at", { ascending: false })
        .limit(1);
      let delta: VenueActivityItem["delta"] = "first-time";
      if (prior && prior.length > 0) {
        const priorId = prior[0].id;
        const { data: priorWines } = await supabase
          .from("scan_wines")
          .select("matched_bottle_id")
          .eq("scan_id", priorId)
          .not("matched_bottle_id", "is", null);
        const priorSet = new Set((priorWines ?? []).map((w: any) => w.matched_bottle_id));
        let newCount = 0;
        for (const bid of g.matched) if (!priorSet.has(bid)) newCount += 1;
        delta = newCount > 0 ? { newSince: newCount } : "updated";
      }

      items.push({
        restaurant_id: rest.id,
        restaurant_name: rest.name,
        city: (rest as any).city ?? null,
        neighborhood: (rest as any).neighborhood ?? null,
        phone: (rest as any).phone ?? null,
        reservation_url: (rest as any).reservation_url ?? null,
        scanned_day: g.day,
        latest_scan_id: g.latestScanId,
        wine_count: g.wines,
        delta,
      });
    }
    items.sort((a, b) => (b.scanned_day + b.latest_scan_id).localeCompare(a.scanned_day + a.latest_scan_id));
    return items.slice(0, data.limit);
  });

// ---------------------------------------------------------------
// Rating share opt-out (per-rating "don't share this one")
// ---------------------------------------------------------------

export const listMyRatingOptouts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("rating_share_optout")
      .select("rating_id")
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => r.rating_id);
  });

const ToggleInput = z.object({
  ratingId: z.string().uuid(),
  hidden: z.boolean(),
});

export const setRatingShareHidden = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => ToggleInput.parse(raw ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Confirm the rating belongs to the caller — RLS on ratings already
    // enforces this, but a mismatched insert would still fail loudly.
    const { data: r } = await supabase
      .from("ratings")
      .select("id, user_id")
      .eq("id", data.ratingId)
      .maybeSingle();
    if (!r || r.user_id !== userId) throw new Error("Not your rating");

    if (data.hidden) {
      const { error } = await supabase
        .from("rating_share_optout")
        .upsert({ user_id: userId, rating_id: data.ratingId }, { onConflict: "user_id,rating_id" });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("rating_share_optout")
        .delete()
        .eq("user_id", userId)
        .eq("rating_id", data.ratingId);
      if (error) throw new Error(error.message);
    }
    return { ok: true, hidden: data.hidden };
  });

// ---------------------------------------------------------------
// Founder account (opt-in; empty by default)
// ---------------------------------------------------------------

export type FounderCardData = {
  user_id: string;
  username: string;
  display_name: string | null;
  palate_code_red: string;
  palate_code_white: string;
  tagline: string | null;
} | null;

export const getFounderAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FounderCardData> => {
    const { supabase } = context;
    const { data: f } = await supabase
      .from("founder_accounts")
      .select("id, tagline")
      .order("added_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!f) return null;
    const { data: p } = await supabase
      .from("profiles")
      .select("id, username, display_name, palate_code_red, palate_code_white")
      .eq("id", (f as any).id)
      .maybeSingle();
    if (!p) return null;
    return {
      user_id: p.id,
      username: p.username,
      display_name: p.display_name,
      palate_code_red: p.palate_code_red,
      palate_code_white: p.palate_code_white,
      tagline: (f as any).tagline ?? null,
    };
  });

// ---------------------------------------------------------------
// Palate-overlap suggestions — public users only, ranked by proximity
// of their palate_code_red/white to the viewer's.
// ---------------------------------------------------------------

function codeDistance(a: string | null | undefined, b: string | null | undefined): number {
  const sa = (a ?? "").padEnd(5, "·").slice(0, 5);
  const sb = (b ?? "").padEnd(5, "·").slice(0, 5);
  let d = 0;
  for (let i = 0; i < 5; i++) if (sa[i] !== sb[i]) d += 1;
  return d;
}

export type OverlapSuggestion = {
  user_id: string;
  username: string;
  display_name: string | null;
  palate_code_red: string;
  palate_code_white: string;
  overlap: number; // 0..1, higher = closer
};

const OverlapInput = z.object({ limit: z.number().int().min(1).max(20).default(5) });

export const getPaletteOverlapSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => OverlapInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<OverlapSuggestion[]> => {
    const { supabase, userId } = context;
    const { data: me } = await supabase
      .from("profiles")
      .select("palate_code_red, palate_code_white")
      .eq("id", userId)
      .maybeSingle();
    if (!me) return [];

    // Public users only. Cap pool at 500; ranking is on the client.
    const { data: pool, error } = await supabase
      .from("profiles")
      .select("id, username, display_name, palate_code_red, palate_code_white, visibility")
      .eq("visibility", "public")
      .neq("id", userId)
      .limit(500);
    if (error) throw new Error(error.message);

    const scored = (pool ?? []).map((p: any) => {
      const dr = codeDistance(me.palate_code_red, p.palate_code_red);
      const dw = codeDistance(me.palate_code_white, p.palate_code_white);
      const overlap = 1 - (dr + dw) / 10; // 0..1
      return {
        user_id: p.id,
        username: p.username,
        display_name: p.display_name,
        palate_code_red: p.palate_code_red,
        palate_code_white: p.palate_code_white,
        overlap,
      };
    });
    scored.sort((a, b) => b.overlap - a.overlap);
    return scored.slice(0, data.limit);
  });
