// Persistent scan history — list, load-for-rerank, share.
//
// Load-bearing invariant: rankings are NEVER stored. We return facts
// (matched bottle_id + parsed fp + raw text + price) and the client
// recomputes the ranking against the viewer's current palate.
//
// Sharing: a scan gets a share_token; recipients read via loadSharedScan
// and rank using their own palate (or view the raw list signed out).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Anon-key client for the public share read path.
function isNewKey(v: string) { return v.startsWith("sb_publishable_") || v.startsWith("sb_secret_"); }
async function publicSupabase() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.SUPABASE_URL || "https://xyxanewatmrekdqowqao.supabase.co";
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_uBdGKhTkSyYWE3SJQXa-PA_wAxapy9_";
  return createClient(url, key, {
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (isNewKey(key) && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export type ScanListItem = {
  id: string;
  scanned_at: string;
  status: string;
  restaurant_id: string | null;
  restaurant_name: string | null;
  venue_raw_text: string | null;
  wine_count: number;
  matched_count: number;
  share_token: string | null;
};

export const listUserScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: scans, error } = await supabase
      .from("scans")
      .select("id,scanned_at,status,restaurant_id,venue_raw_text,share_token,created_at")
      .eq("user_id", userId)
      .order("scanned_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const list = (scans ?? []) as any[];
    if (list.length === 0) return [] as ScanListItem[];

    const ids = list.map((s) => s.id);
    const restaurantIds = list.map((s) => s.restaurant_id).filter(Boolean) as string[];

    const [{ data: wineCounts }, { data: rests }] = await Promise.all([
      supabase.from("scan_wines")
        .select("scan_id,matched_bottle_id")
        .in("scan_id", ids),
      restaurantIds.length
        ? supabase.from("restaurants").select("id,name").in("id", restaurantIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const nameById = new Map<string, string>();
    for (const r of (rests as any[]) ?? []) nameById.set(r.id, r.name);
    const counts = new Map<string, { total: number; matched: number }>();
    for (const row of (wineCounts as any[]) ?? []) {
      const c = counts.get(row.scan_id) ?? { total: 0, matched: 0 };
      c.total += 1;
      if (row.matched_bottle_id) c.matched += 1;
      counts.set(row.scan_id, c);
    }

    return list.map((s): ScanListItem => {
      const c = counts.get(s.id) ?? { total: 0, matched: 0 };
      return {
        id: s.id,
        scanned_at: s.scanned_at ?? s.created_at,
        status: s.status,
        restaurant_id: s.restaurant_id,
        restaurant_name: s.restaurant_id ? nameById.get(s.restaurant_id) ?? null : null,
        venue_raw_text: s.venue_raw_text,
        wine_count: c.total,
        matched_count: c.matched,
        share_token: s.share_token,
      };
    });
  });

export type StoredScanRow = {
  id: string;
  scan_id: string;
  batch_index: number;
  producer: string | null;
  cuvee: string | null;
  vintage: number | null;
  wine_type: string | null;
  region: string | null;
  grape: string | null;
  price: string | null;
  price_amount: number | null;
  currency: string | null;
  format: string | null;
  raw_text: string | null;
  fp: any;
  fp_source: string | null;
  matched_bottle_id: string | null;
  match_score: number | null;
};

export type ScanDetail = {
  id: string;
  scanned_at: string;
  status: string;
  restaurant: { id: string; name: string; city: string | null } | null;
  venue_raw_text: string | null;
  share_token: string | null;
  wines: StoredScanRow[];
};

export const loadScanForRanking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ scan_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ScanDetail> => {
    const { supabase, userId } = context;
    const { data: scan, error } = await supabase
      .from("scans")
      .select("id,user_id,scanned_at,status,restaurant_id,venue_raw_text,share_token,created_at")
      .eq("id", data.scan_id)
      .single();
    if (error || !scan) throw new Error("Scan not found");
    if ((scan as any).user_id !== userId) throw new Error("Not your scan");

    const [{ data: wines }, restRes] = await Promise.all([
      supabase.from("scan_wines")
        .select("id,scan_id,batch_index,producer,cuvee,vintage,wine_type,region,grape,price,price_amount,currency,format,raw_text,fp,fp_source,matched_bottle_id,match_score")
        .eq("scan_id", data.scan_id),
      (scan as any).restaurant_id
        ? supabase.from("restaurants").select("id,name,city").eq("id", (scan as any).restaurant_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    return {
      id: (scan as any).id,
      scanned_at: (scan as any).scanned_at ?? (scan as any).created_at,
      status: (scan as any).status,
      restaurant: (restRes as any).data ?? null,
      venue_raw_text: (scan as any).venue_raw_text,
      share_token: (scan as any).share_token,
      wines: ((wines as any[]) ?? []) as StoredScanRow[],
    };
  });

export const shareScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ scan_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase.from("scans")
      .select("id,user_id,share_token")
      .eq("id", data.scan_id).maybeSingle();
    if (!existing || (existing as any).user_id !== userId) throw new Error("Not your scan");
    if ((existing as any).share_token) return { share_token: (existing as any).share_token as string };
    // 24-char urlsafe token.
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const token = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const { error } = await supabase.from("scans").update({ share_token: token }).eq("id", data.scan_id);
    if (error) throw new Error(error.message);
    return { share_token: token };
  });

export const loadSharedScan = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(4).max(64) }).parse(input))
  .handler(async ({ data }): Promise<ScanDetail | null> => {
    const supabase = await publicSupabase();
    const { data: scan } = await supabase
      .from("scans")
      .select("id,scanned_at,status,restaurant_id,venue_raw_text,share_token,created_at")
      .eq("share_token", data.token)
      .maybeSingle();
    if (!scan) return null;
    const [{ data: wines }, restRes] = await Promise.all([
      supabase.from("scan_wines")
        .select("id,scan_id,batch_index,producer,cuvee,vintage,wine_type,region,grape,price,price_amount,currency,format,raw_text,fp,fp_source,matched_bottle_id,match_score")
        .eq("scan_id", (scan as any).id),
      (scan as any).restaurant_id
        ? supabase.from("restaurants").select("id,name,city").eq("id", (scan as any).restaurant_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    return {
      id: (scan as any).id,
      scanned_at: (scan as any).scanned_at ?? (scan as any).created_at,
      status: (scan as any).status,
      restaurant: (restRes as any).data ?? null,
      venue_raw_text: (scan as any).venue_raw_text,
      share_token: (scan as any).share_token,
      wines: ((wines as any[]) ?? []) as StoredScanRow[],
    };
  });
