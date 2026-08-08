// Venue activity feed (no consent), rating opt-outs, palate-overlap
// suggestions, and founder account lookup. All read-only or user-owned
// writes — nothing here writes another user's data.

import { axesFor, parseCode, type PaletteType } from "@/lib/palate";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------------------------------------------------------
// Venue activity — 2A
// ---------------------------------------------------------------
//
// A scanned wine list is a fact about a restaurant. We aggregate by
// restaurant across ALL of its list scans (not per day), then enforce an
// attribution floor on that aggregate: a venue with three 4-wine scans is
// still a venue worth showing, and the aggregate reveals no more about any
// individual scanner than a daily grain does.

const MIN_WINES_FOR_ATTRIBUTION = 8;

/** Statuses where the wines have actually been parsed out of the photos. */
const READ_STATUSES = ["parsed", "complete", "partial"];

export type VenueActivityItem = {
  restaurant_id: string;
  restaurant_name: string;
  city: string | null;
  neighborhood: string | null;
  phone: string | null;
  reservation_url: string | null;
  scanned_day: string; // YYYY-MM-DD (UTC) of the latest scan
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

    // Every readable list-scan with a restaurant, newest first.
    const { data: recent, error } = await supabase
      .from("scans")
      .select("id, restaurant_id, scanned_at")
      .eq("kind", "list")
      .in("status", READ_STATUSES)
      .not("restaurant_id", "is", null)
      .order("scanned_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const rows = (recent ?? []).filter((r) => !!r.restaurant_id);
    if (rows.length === 0) return [];

    // Wine sets per scan.
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

    // Group by restaurant across all scans.
    type Group = {
      restaurantId: string;
      latestScanId: string;
      latestAt: string;
      scanCount: number;
      wines: number;
      matched: Set<string>;
      priorMatched: Set<string>; // everything seen before the latest scan
    };
    const groups = new Map<string, Group>();
    for (const r of rows) {
      const c = perScan.get(r.id) ?? { total: 0, matchedBottleIds: new Set<string>() };
      const at = r.scanned_at as string;
      const g = groups.get(r.restaurant_id!);
      if (!g) {
        groups.set(r.restaurant_id!, {
          restaurantId: r.restaurant_id!,
          latestScanId: r.id,
          latestAt: at,
          scanCount: 1,
          wines: c.total,
          matched: new Set(c.matchedBottleIds),
          priorMatched: new Set<string>(),
        });
        continue;
      }
      g.scanCount += 1;
      g.wines += c.total;
      if (at > g.latestAt) {
        // This scan is the new anchor; the old anchor's wines become prior.
        g.matched.forEach((id) => g.priorMatched.add(id));
        g.latestAt = at;
        g.latestScanId = r.id;
        g.matched = new Set(c.matchedBottleIds);
      } else {
        c.matchedBottleIds.forEach((id) => g.priorMatched.add(id));
      }
    }

    const eligible = Array.from(groups.values()).filter(
      (g) => g.wines >= MIN_WINES_FOR_ATTRIBUTION,
    );
    if (eligible.length === 0) return [];

    const restaurantIds = eligible.map((g) => g.restaurantId);
    const { data: rests } = await supabase
      .from("restaurants")
      .select("id, name, city, neighborhood, phone, reservation_url")
      .in("id", restaurantIds);
    const restById = new Map((rests ?? []).map((r) => [r.id, r]));

    const items: VenueActivityItem[] = [];
    for (const g of eligible) {
      const rest = restById.get(g.restaurantId);
      if (!rest) continue;

      let delta: VenueActivityItem["delta"] = "first-time";
      if (g.scanCount > 1) {
        let newCount = 0;
        for (const bid of g.matched) if (!g.priorMatched.has(bid)) newCount += 1;
        delta = newCount > 0 ? { newSince: newCount } : "updated";
      }

      items.push({
        restaurant_id: rest.id,
        restaurant_name: rest.name,
        city: (rest as any).city ?? null,
        neighborhood: (rest as any).neighborhood ?? null,
        phone: (rest as any).phone ?? null,
        reservation_url: (rest as any).reservation_url ?? null,
        scanned_day: g.latestAt.slice(0, 10),
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

function codeDistance(a: string | null | undefined, b: string | null | undefined, type: PaletteType): number {
  // Slot-wise, not character-wise: a slot can be "G±". Unresolved slots ("?")
  // count as a difference only against a resolved one, never as a match.
  const axes = axesFor(type);
  const sa = parseCode(a ?? "", axes);
  const sb = parseCode(b ?? "", axes);
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
      const dr = codeDistance(me.palate_code_red, p.palate_code_red, "red");
      const dw = codeDistance(me.palate_code_white, p.palate_code_white, "white");
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
