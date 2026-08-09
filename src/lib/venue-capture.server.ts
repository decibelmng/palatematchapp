// Venue fact capture — the only writer of restaurant_wines and
// price_observations.
//
// This ran inline inside finalizeScan and was therefore reachable only when the
// venue was already known at finalize time. Since nothing set the venue before
// finalize, it never ran once. It now lives here so both finalize and
// after-the-fact attribution use the same code path.
//
// Two rules learned the hard way:
//   - restaurant_wines.source_scan_id references scan_logs.id, NOT scans.id.
//     Passing a scans.id raised a foreign-key error that the caller's single
//     try/catch swallowed, aborting capture for the whole scan.
//   - Per-row try/catch: one bad line must not discard the other forty.

import { cuveeKey } from "@/lib/cuvee";

export type CaptureRow = {
  producer: string | null;
  cuvee: string | null;
  price: string | null;
  price_amount: number | null;
  currency: string | null;
  format: string | null;
  raw_text: string | null;
  matched_bottle_id: string | null;
};

export type CaptureResult = { edges: number; prices: number };

export async function captureVenueFacts(opts: {
  restaurantId: string;
  userId: string;
  /** scan_logs.id — the only value restaurant_wines.source_scan_id accepts. */
  scanLogId: string | null;
  scanId: string;
  observedAt: string;
  rows: CaptureRow[];
}): Promise<CaptureResult> {
  const { restaurantId, userId, scanLogId, scanId, observedAt, rows } = opts;
  let edges = 0;
  let prices = 0;
  if (rows.length === 0) return { edges, prices };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  for (const r of rows) {
    const amount = r.price_amount ?? null;
    const format = r.format ?? "bottle";
    const currency = r.currency ?? "USD";
    const ckey = cuveeKey({ producer: r.producer, name: r.cuvee ?? "" });

    if (r.matched_bottle_id) {
      try {
        const { data: existing } = await supabaseAdmin
          .from("restaurant_wines")
          .select("id,seen_count")
          .eq("restaurant_id", restaurantId)
          .eq("bottle_id", r.matched_bottle_id)
          .eq("format", format)
          .maybeSingle();
        if (existing) {
          const { error } = await supabaseAdmin.from("restaurant_wines").update({
            last_seen_at: observedAt,
            seen_count: (existing.seen_count ?? 1) + 1,
            menu_price: r.price ?? undefined,
            menu_price_amount: amount ?? undefined,
            source_scan_id: scanLogId,
          }).eq("id", existing.id);
          if (!error) edges++;
        } else {
          const { error } = await supabaseAdmin.from("restaurant_wines").insert({
            restaurant_id: restaurantId,
            bottle_id: r.matched_bottle_id,
            format,
            menu_price: r.price ?? null,
            menu_price_amount: amount,
            first_seen_at: observedAt,
            last_seen_at: observedAt,
            seen_count: 1,
            source_scan_id: scanLogId,
            added_by: userId,
          } as never);
          if (!error) edges++;
          else console.error("[venue-capture] edge insert failed:", error.message);
        }
      } catch (e) {
        console.error("[venue-capture] edge failed:", (e as Error).message);
      }
    }

    // Append-only: matched AND unmatched lines. Unmatched keeps bottle_id null
    // and preserves raw_line + cuvee_key for later re-resolution.
    if (amount && amount > 0) {
      try {
        const { error } = await supabaseAdmin.from("price_observations").insert({
          restaurant_id: restaurantId,
          bottle_id: r.matched_bottle_id ?? null,
          cuvee_key: ckey || null,
          raw_line: r.raw_text ?? r.price ?? null,
          menu_price: amount,
          currency,
          format,
          scan_id: scanId,
          user_id: userId,
          source: "ocr",
          observed_at: observedAt,
        } as never);
        if (!error) prices++;
        else console.error("[venue-capture] price insert failed:", error.message);
      } catch (e) {
        console.error("[venue-capture] price failed:", (e as Error).message);
      }
    }
  }

  return { edges, prices };
}
