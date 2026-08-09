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
  kind: "list" | "bottle";
  scanned_at: string;
  status: string;
  restaurant_id: string | null;
  restaurant_name: string | null;
  venue_raw_text: string | null;
  wine_count: number;
  matched_count: number;
  share_token: string | null;
  // Bottle-scan-only:
  front_thumb_url: string | null;
  bottle_label: string | null; // "Producer — Cuvee, Vintage" or similar
  rated_stars: number | null;
  /** Wines the person marked as ordered on this scan that they have not rated
   *  yet. Facts only — the prompt names the wine instead of guessing. */
  ordered_unrated: { bottle_id: string; name: string }[];
};


export const listUserScans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: scans, error } = await supabase
      .from("scans")
      .select("id,kind,scanned_at,status,restaurant_id,venue_raw_text,share_token,created_at,front_image_path")
      .eq("user_id", userId)
      .order("scanned_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const list = (scans ?? []) as any[];
    if (list.length === 0) return [] as ScanListItem[];

    const ids = list.map((s) => s.id);
    const restaurantIds = list.map((s) => s.restaurant_id).filter(Boolean) as string[];

    const [{ data: wineRows }, { data: rests }] = await Promise.all([
      supabase.from("scan_wines")
        .select("scan_id,matched_bottle_id,producer,cuvee,vintage,user_rated_stars,batch_index")
        .in("scan_id", ids),
      restaurantIds.length
        ? supabase.from("restaurants").select("id,name").in("id", restaurantIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const nameById = new Map<string, string>();
    for (const r of (rests as any[]) ?? []) nameById.set(r.id, r.name);
    const counts = new Map<string, { total: number; matched: number }>();
    const bottleByScan = new Map<string, any>();
    for (const row of (wineRows as any[]) ?? []) {
      const c = counts.get(row.scan_id) ?? { total: 0, matched: 0 };
      c.total += 1;
      if (row.matched_bottle_id) c.matched += 1;
      counts.set(row.scan_id, c);
      if (!bottleByScan.has(row.scan_id)) bottleByScan.set(row.scan_id, row);
    }

    // Sign label thumbnails (private bucket).
    const thumbByScan = new Map<string, string>();
    const withLabels = list.filter((s) => s.kind === "bottle" && s.front_image_path);
    if (withLabels.length > 0) {
      const paths = withLabels.map((s) => s.front_image_path as string);
      const { data: signed } = await supabase.storage.from("scan-images")
        .createSignedUrls(paths, 60 * 60);
      const byPath = new Map<string, string>();
      for (const s of signed ?? []) if ((s as any).path && (s as any).signedUrl) byPath.set((s as any).path, (s as any).signedUrl);
      for (const s of withLabels) {
        const u = byPath.get(s.front_image_path as string);
        if (u) thumbByScan.set(s.id, u);
      }
    }

    // Wines marked "I ordered this" that still have no rating. The prompt has
    // to name the wine, so it reads the outcome rows rather than inferring.
    const orderedByScan = new Map<string, { bottle_id: string; name: string }[]>();
    {
      const { data: outcomes } = await supabase
        .from("scan_outcomes")
        .select("scan_id,chosen_bottle_id")
        .eq("user_id", userId)
        .in("scan_id", ids);
      const rows = ((outcomes as any[]) ?? []).filter((o) => o.chosen_bottle_id);
      const bottleIds = [...new Set(rows.map((o) => o.chosen_bottle_id as string))];
      if (bottleIds.length > 0) {
        const [{ data: bottles }, { data: rated }] = await Promise.all([
          supabase.from("bottles").select("id,name,producer,vintage").in("id", bottleIds),
          supabase.from("ratings").select("bottle_id").eq("user_id", userId).in("bottle_id", bottleIds),
        ]);
        const ratedIds = new Set(((rated as any[]) ?? []).map((r) => r.bottle_id as string));
        const nameOf = new Map<string, string>();
        for (const b of ((bottles as any[]) ?? [])) {
          // Never truncate: the catalog name already carries producer + vintage.
          nameOf.set(b.id, (b.name as string) ?? [b.producer, b.vintage].filter(Boolean).join(" "));
        }
        for (const o of rows) {
          const id = o.chosen_bottle_id as string;
          if (ratedIds.has(id)) continue;
          const name = nameOf.get(id);
          if (!name) continue;
          const list0 = orderedByScan.get(o.scan_id) ?? [];
          if (!list0.some((x) => x.bottle_id === id)) list0.push({ bottle_id: id, name });
          orderedByScan.set(o.scan_id, list0);
        }
      }
    }

    return list.map((s): ScanListItem => {
      const c = counts.get(s.id) ?? { total: 0, matched: 0 };
      const kind: "list" | "bottle" = s.kind === "bottle" ? "bottle" : "list";
      const bw = bottleByScan.get(s.id);
      const label = bw
        ? [bw.producer, bw.cuvee].filter(Boolean).join(" — ") +
          (bw.vintage ? `, ${bw.vintage}` : "")
        : null;
      return {
        id: s.id,
        kind,
        scanned_at: s.scanned_at ?? s.created_at,
        status: s.status,
        restaurant_id: s.restaurant_id,
        restaurant_name: s.restaurant_id ? nameById.get(s.restaurant_id) ?? null : null,
        venue_raw_text: s.venue_raw_text,
        wine_count: c.total,
        matched_count: c.matched,
        share_token: s.share_token,
        front_thumb_url: thumbByScan.get(s.id) ?? null,
        bottle_label: kind === "bottle" ? (label || null) : null,
        rated_stars: kind === "bottle" && bw?.user_rated_stars ? bw.user_rated_stars : null,
        ordered_unrated: orderedByScan.get(s.id) ?? [],
      };
    });

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

    // Reconcile-on-read: a scan whose batches all landed but whose finalize was
    // lost (app backgrounded at the table) gets finalized now, on open.
    if ((scan as any).status === "processing") {
      try {
        const { reconcileOne } = await import("@/lib/scan-finalize.server");
        const res = await reconcileOne(supabase as any, userId, data.scan_id);
        if (res.reconciled) (scan as any).status = res.status;
      } catch { /* a reconcile failure must never block opening the scan */ }
    }


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
  .inputValidator((input: unknown) => z.object({ token: z.string().min(8).max(64) }).parse(input))
  .handler(async ({ data }): Promise<ScanDetail | null> => {
    const supabase = await publicSupabase();
    const { data: payload, error } = await supabase.rpc("load_shared_scan", { p_token: data.token });
    if (error) throw new Error(error.message);
    if (!payload) return null;
    const p = payload as any;
    return {
      id: p.id,
      scanned_at: p.scanned_at,
      status: p.status,
      restaurant: p.restaurant ?? null,
      venue_raw_text: p.venue_raw_text,
      share_token: p.share_token,
      wines: (p.wines ?? []) as StoredScanRow[],
    };
  });
