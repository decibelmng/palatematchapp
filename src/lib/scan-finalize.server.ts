// Server-only finalize core.
//
// finalizeScan was the ONLY writer that could move a scan out of "processing",
// and it is client-called: a phone that backgrounds at the table (the normal
// case, not an edge case) orphaned the scan with its parsed wines already in
// scan_wines. The whole body lives here so three callers can drive it:
//   1. finalizeScan (the client call, unchanged)
//   2. reconcile-on-read, when a stuck scan is reopened
//   3. the scheduled reconciler, for scans nobody reopens
//
// It is idempotent by construction: status is recomputed from batch counters,
// restaurant resolution is skipped when already set, the C2 backfill skips rows
// that already have a bottle, and price_observations is append-only by design.

import type { SupabaseClient } from "@supabase/supabase-js";
import { detectCurrencyFromText } from "@/lib/currency";

export type FinalizeResult = {
  status: "processing" | "partial" | "complete" | "failed";
  scan_log_id: string | null;
  restaurant_id: string | null;
};

export async function finalizeScanCore(
  supabase: SupabaseClient,
  userId: string,
  scanId: string,
): Promise<FinalizeResult> {
    const { data: scan } = await supabase.from("scans")
      .select("batches_done,batch_count,batches_failed,image_paths,venue_raw_text,restaurant_id,scanned_at")
      .eq("id", scanId).single();
    if (!scan) throw new Error("Scan not found");
    const failed = ((scan.batches_failed ?? []) as number[]);
    const done = scan.batches_done ?? 0;
    const total = scan.batch_count ?? 0;
    let status: "processing" | "partial" | "complete" | "failed";
    if (done === total && failed.length === 0) status = "complete";
    else if (done > 0 && failed.length > 0) status = "partial";
    else if (done === 0 && failed.length > 0) status = "failed";
    else status = "processing";
    await supabase.from("scans").update({ status }).eq("id", scanId);

    // ---- Silent capture: resolve restaurant from venue_raw_text if set ----
    let restaurantId: string | null = (scan as any).restaurant_id ?? null;
    if (!restaurantId && (scan as any).venue_raw_text) {
      try {
        const { FuzzyRestaurantResolver } = await import("@/lib/restaurant-resolver");
        const resolver = new FuzzyRestaurantResolver(supabase as any);
        const res = await resolver.resolve((scan as any).venue_raw_text as string, userId);
        if (res) {
          restaurantId = res.restaurant_id;
          await supabase.from("scans").update({ restaurant_id: restaurantId }).eq("id", scanId);
        }
      } catch { /* resolver failure never blocks scan */ }
    }

    // Mirror aggregated wines into scan_logs for existing restaurant-attribution flow.
    const { data: rowsRaw } = await supabase.from("scan_wines")
      .select("id,producer,cuvee,vintage,region,grape,price,price_amount,currency,format,raw_text,wine_type,fp,fp_source,matched_bottle_id")
      .eq("scan_id", scanId);
    const rows = (rowsRaw ?? []) as any[];

    // Aggregate the scan-wide currency from per-row detections and persist it
    // on the scans row so downstream reads (list controls, price banding) can
    // label chips in the currency the user actually saw on the list.
    //
    // Re-detect from raw text/price rather than trusting scan_wines.currency,
    // because that column falls back to "USD" when no symbol was read — we
    // must not confuse that default with actual OCR evidence when deciding
    // whether to teach the restaurant its currency below.
    let textDetectedCurrency: string | null = null;
    try {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const c = detectCurrencyFromText(r.price ?? r.raw_text ?? null);
        if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      let winner: string | null = null; let best = 0;
      for (const [k, v] of counts) if (v > best) { winner = k; best = v; }
      textDetectedCurrency = winner;
      if (winner) await supabase.from("scans").update({ currency: winner }).eq("id", scanId);
    } catch { /* non-fatal */ }

    // Teach the restaurant its currency — but only from "text" evidence, and
    // only when the column is empty. Locale/default fallbacks never write,
    // so venues can't inherit the first scanner's guess. A later symbol-free
    // scan at the same venue then resolves via source "restaurant".
    if (restaurantId && textDetectedCurrency) {
      try {
        await supabase
          .from("restaurants")
          .update({ currency: textDetectedCurrency })
          .eq("id", restaurantId)
          .is("currency", null);
      } catch { /* non-fatal */ }
    }

    // ---- C2 backfill: resolve/fingerprint unmatched scan lines on-demand ----
    // Any row still carrying matched_bottle_id=null after catalog resolution
    // now runs through resolveOrCreateOnDemandCore. This is the SAME LLM
    // fingerprint pipeline the base catalog used — the new bottle enters the
    // same coordinate space. Identity dedup (producer + name tokens + exact
    // vintage + type) runs first, so a near-dupe LINKS instead of inserting.
    // Failure of a single line never blocks the scan finalize.
    const apiKey = process.env.LOVABLE_API_KEY;
    if (apiKey) {
      const { resolveOrCreateOnDemandCore } = await import("@/lib/on-demand-bottle.functions");
      for (const r of rows) {
        if (r.matched_bottle_id) continue;
        if (!r.producer || !r.cuvee || !r.wine_type) continue;
        try {
          const res = await resolveOrCreateOnDemandCore(supabase as any, userId, apiKey, {
            producer: r.producer, name: r.cuvee, type: r.wine_type,
            region: r.region ?? null, grape: r.grape ?? null, vintage: r.vintage ?? null,
          });
          r.matched_bottle_id = res.bottle_id;
          r.fp_source = res.reason === "identity-linked" ? "catalog" : "estimated";
          await supabase.from("scan_wines").update({
            matched_bottle_id: res.bottle_id,
            fp_source: r.fp_source,
            match_reasons: [res.reason] as any,
          }).eq("id", r.id);
        } catch { /* single-line C2 failures are best-effort */ }
      }
    }
    // ---- Persist predicted_stars per scan line ----
    // Written AFTER the C2 backfill so on-demand bottles are included. This is
    // the denominator for accuracy: without it we can only see the wines
    // someone chose to rate, never the ones we offered and they walked past.
    // Scores stay computed-on-read everywhere they are *shown*; this column is
    // an audit record of what we said at finalize time, not a served value.
    try {
      const ids = (rows ?? [])
        .map((r: any) => r.matched_bottle_id)
        .filter((id: string | null): id is string => !!id);
      if (ids.length > 0) {
        const { predictForBottlesCore } = await import("@/lib/predict.functions");
        const preds = await predictForBottlesCore(supabase as any, userId, ids);
        for (const r of rows as any[]) {
          if (!r.matched_bottle_id) continue;
          const p = preds.get(r.matched_bottle_id);
          if (!p || p.predicted === null) continue;
          r.predicted_stars = p.predicted;
          await supabase.from("scan_wines")
            .update({ predicted_stars: p.predicted })
            .eq("id", r.id);
        }
      }
    } catch { /* an unmeasured scan must never block the user's list */ }

    const winesForLog = (rows ?? []).map((r: any) => ({

      producer: r.producer, wine_name: r.cuvee, vintage: r.vintage,
      region: r.region, grape: r.grape, price: r.price, type: r.wine_type,
      fp_resolved: r.fp, fp_source: r.fp_source, matched_bottle_id: r.matched_bottle_id,
      matched_bottle_name: null, match_score: 0,
    }));
    let scan_log_id: string | null = null;
    try {
      const { data: log } = await supabase.from("scan_logs").insert({
        user_id: userId,
        n_photos: (scan.image_paths as string[] | null)?.length ?? 0,
        total_wines: winesForLog.length,
        matched_count: winesForLog.filter((w: any) => w.fp_source === "catalog").length,
        estimated_count: winesForLog.filter((w: any) => w.fp_source === "estimated").length,
        unreadable_count: winesForLog.filter((w: any) => !w.fp_resolved).length,
        wines: winesForLog as any,
        image_paths: (scan.image_paths as any) ?? [],
        status,
        restaurant_id: restaurantId,
      }).select("id").single();
      scan_log_id = log?.id ?? null;
    } catch { /* logging best-effort */ }

    // ---- Silent capture: restaurant_wines + append-only price_observations ----
    // Ranking always recomputed against current palate; only *facts* land here.
    // A capture failure MUST NOT break the user's ranked-list return.
    //
    // Segmentation rules of record:
    //   - restaurant_wines is keyed by (restaurant_id, bottle_id, format) so
    //     bottle/glass/half pours are separate listings and never overwrite.
    //   - Unmatched lines (bottle_id null) still append price_observations
    //     with raw_line + cuvee_key preserved. We NEVER fabricate a bottle_id.
    //   - price_observations is append-only + timestamped: a re-scan appends
    //     a fresh row, never overwrites.
    if (restaurantId && rows.length > 0) {
      const { captureVenueFacts } = await import("@/lib/venue-capture.server");
      await captureVenueFacts({
        restaurantId,
        userId,
        scanLogId: scan_log_id,
        scanId: scanId,
        observedAt: ((scan as any).scanned_at as string | null) ?? new Date().toISOString(),
        rows: rows as any[],
      });
    }

    return { status, scan_log_id, restaurant_id: restaurantId };
}
