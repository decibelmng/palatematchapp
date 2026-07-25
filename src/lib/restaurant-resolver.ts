// Restaurant resolver — swappable behind an interface.
//
// Fuzzy implementation for now; Google Places (or similar) can drop in later
// without touching capture code. Rule of record: link to an existing venue
// ONLY on a strong match; when unsure, insert new + flag possible_duplicate.
// A duplicate is mergeable later; a wrong merge corrupts price history.
//
// Server-only. Do not import from client bundles.

import type { SupabaseClient } from "@supabase/supabase-js";

export type ResolveHint = { lat?: number; lng?: number };

export type ResolveResult = {
  restaurant_id: string;
  confidence: number;
  canonical_name: string;
  created: boolean;
  flag_possible_duplicate: boolean;
};

export interface RestaurantResolver {
  resolve(
    venue: string,
    userId: string,
    hint?: ResolveHint,
  ): Promise<ResolveResult | null>;
}

const NOISE = new Set([
  "restaurant","the","hotel","cafe","café","bar","winery","inn","kitchen",
  "bistro","grill","house","room","tavern","co","company","and","&",
]);

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NOISE.has(t))
    .join(" ")
    .trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const hits = a.filter((t) => setB.has(t)).length;
  return hits / Math.max(a.length, b.length);
}

export class FuzzyRestaurantResolver implements RestaurantResolver {
  constructor(private supabase: SupabaseClient) {}

  async resolve(venue: string, userId: string): Promise<ResolveResult | null> {
    const raw = venue.trim();
    if (raw.length < 2) return null;
    const normed = normalize(raw);
    if (!normed) return null;
    const wanted = tokens(raw);

    // Query candidates via existing search_restaurants; fall back to a broad LIKE.
    const { data: rpcCands } = await this.supabase.rpc("search_restaurants", { q: raw, lim: 8 });
    const candidates = (rpcCands ?? []) as Array<{ id: string; name: string; city: string | null; locale: string | null }>;

    let best: { row: (typeof candidates)[number]; score: number } | null = null;
    for (const row of candidates) {
      const score = tokenOverlap(wanted, tokens(row.name));
      if (!best || score > best.score) best = { row, score };
    }

    // Strong match → link.
    if (best && best.score >= 0.85) {
      // Refresh venue_raw_text_last (best-effort).
      try {
        await this.supabase.from("restaurants")
          .update({ venue_raw_text_last: raw })
          .eq("id", best.row.id);
      } catch { /* non-critical */ }
      return {
        restaurant_id: best.row.id,
        confidence: best.score,
        canonical_name: best.row.name,
        created: false,
        flag_possible_duplicate: false,
      };
    }

    // Weak match or none → insert new; flag possible_duplicate when a weak-ish
    // candidate exists so an admin can merge later.
    const flag = !!(best && best.score >= 0.5);
    const { data: inserted, error } = await this.supabase
      .from("restaurants")
      .insert({
        name: raw,
        venue_raw_text_last: raw,
        possible_duplicate: flag,
        created_by: userId,
      })
      .select("id,name")
      .single();
    if (error || !inserted) return null;

    return {
      restaurant_id: inserted.id,
      confidence: best?.score ?? 0,
      canonical_name: inserted.name,
      created: true,
      flag_possible_duplicate: flag,
    };
  }
}
