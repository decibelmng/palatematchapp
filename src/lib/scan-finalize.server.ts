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
import { resolveCurrency, type CurrencyCode } from "@/lib/currency";

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

    // Aggregate the scan-wide currency and persist it WITH its derivation.
    //
    // Two consumers, two different standards of evidence — conflating them is
    // what left scans.currency null on all 79 existing scans:
    //
    //   - scans.currency is for DISPLAY. A list printing bare numbers (0 of 71
    //     rows on the reference scan carried a symbol) still has to label
    //     chips, so the ladder falls through venue → default rather than
    //     writing nothing at all. Writing nothing is what forced every reader
    //     to re-derive it and gave the venue path nothing to learn from.
    //   - restaurants.currency is a FACT taught to a venue, so it is written
    //     only from "text" evidence. A venue must never inherit a scanner's
    //     locale or the USD default, because a later symbol-free scan there
    //     resolves via source "restaurant" and would launder the guess into
    //     something that reads like observed truth.
    //
    // currency_source records which rung fired, so a USD written off the
    // default is never mistaken for a USD read off a dollar sign.
    let textDetectedCurrency: CurrencyCode | null = null;
    try {
      const samples = rows.map((r) => (r.price ?? r.raw_text ?? null) as string | null);
      const textOnly = resolveCurrency({ samples, useLocale: false });
      textDetectedCurrency = textOnly.source === "text" ? textOnly.currency : null;

      let venueCurrency: CurrencyCode | null = null;
      if (restaurantId) {
        const { data: rest } = await supabase
          .from("restaurants").select("currency").eq("id", restaurantId).maybeSingle();
        const c = (rest as { currency?: string | null } | null)?.currency ?? null;
        venueCurrency = c === "USD" || c === "EUR" || c === "GBP" ? c : null;
      }

      // useLocale: false — there is no browser locale on the server, and
      // guessing one from request headers would be a fabricated rung.
      const resolved = resolveCurrency({
        samples, restaurantCurrency: venueCurrency, useLocale: false,
      });
      await supabase.from("scans")
        .update({ currency: resolved.currency, currency_source: resolved.source })
        .eq("id", scanId);
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
    // scan_wines.predicted_stars used to be written here, N+1 round-trips deep,
    // as "the denominator for accuracy". prediction_outcomes now captures that
    // properly — with the palate_version, pipeline, rank and axis deltas that
    // make a stored score interpretable — so this column was a worse copy of a
    // better record, and one that invariant 5 forbids: a prediction is not a
    // fact about a wine. Dropped, along with its per-row UPDATE loop.



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

/**
 * Mark every batch that never reported as failed, so the counters add up and
 * finalizeScanCore can classify the scan.
 *
 * This exists because the old skip condition (`done + failed < total` → leave
 * alone) meant the scans that most needed rescuing — a handler that died
 * BEFORE it could call mark_scan_batch_done or mark_scan_batch_failed — were
 * the only ones the reconciler would never touch. Those sat in "processing"
 * forever. A batch that has not reported long past the cutoff did not report;
 * treating it as failed yields "partial" when other pages landed and "failed"
 * when none did, which is the truth in both cases.
 */
async function abandonUnreportedBatches(
  supabase: SupabaseClient,
  scanId: string,
  total: number,
  failedIdx: number[],
): Promise<void> {
  const { data: rows } = await supabase
    .from("scan_wines").select("batch_index").eq("scan_id", scanId);
  const landed = new Set<number>(((rows ?? []) as any[]).map((r) => r.batch_index as number));
  const nextFailed = new Set<number>(failedIdx);
  for (let i = 0; i < total; i++) if (!landed.has(i)) nextFailed.add(i);
  await supabase
    .from("scans")
    .update({
      batches_done: landed.size,
      batches_failed: Array.from(nextFailed).sort((a, b) => a - b) as any,
    })
    .eq("id", scanId);
}

/**
 * Finalize a scan only if it is stuck. "All batches reported" finalizes
 * immediately; a scan whose batches never reported is abandoned to
 * failed/partial once it is older than `abandonAfterMinutes`, so a handler that
 * died silently cannot leave the row in "processing" forever.
 */
export async function reconcileOne(
  supabase: SupabaseClient,
  userId: string,
  scanId: string,
  opts: { abandonAfterMinutes?: number } = {},
): Promise<{ reconciled: boolean; status: string | null }> {
  const abandonAfter = opts.abandonAfterMinutes ?? 10;
  const { data: scan } = await supabase
    .from("scans")
    .select("status,batch_count,batches_done,batches_failed,updated_at")
    .eq("id", scanId)
    .maybeSingle();
  if (!scan) return { reconciled: false, status: null };
  if (scan.status !== "processing") return { reconciled: false, status: scan.status as string };
  const done = (scan.batches_done as number | null) ?? 0;
  const total = (scan.batch_count as number | null) ?? 0;
  const failedIdx = ((scan.batches_failed as number[] | null) ?? []);
  if (total === 0) return { reconciled: false, status: "processing" };
  if (done + failedIdx.length < total) {
    const age = Date.now() - new Date((scan as any).updated_at as string).getTime();
    // Genuinely still in flight — the client is mid-scan, leave it alone.
    if (age < abandonAfter * 60_000) return { reconciled: false, status: "processing" };
    await abandonUnreportedBatches(supabase, scanId, total, failedIdx);
  }
  const res = await finalizeScanCore(supabase, userId, scanId);
  return { reconciled: true, status: res.status };
}

/**
 * Scheduled sweep. Finds scans left in "processing" past `olderThanMinutes` and
 * finalizes them — including the ones whose batches never reported, which are
 * abandoned to failed/partial rather than skipped. Bounded per run so one bad
 * scan can't stall the queue and a burst can't run unbounded.
 */
export async function reconcileStuckScans(
  supabase: SupabaseClient,
  opts: { olderThanMinutes?: number; limit?: number } = {},
): Promise<{ examined: number; reconciled: number; abandoned: number; results: Array<{ scan_id: string; status: string | null; abandoned?: boolean; error?: string }> }> {
  const olderThan = opts.olderThanMinutes ?? 10;
  const limit = opts.limit ?? 25;
  const cutoff = new Date(Date.now() - olderThan * 60_000).toISOString();
  const { data: stuck, error } = await supabase
    .from("scans")
    .select("id,user_id,batch_count,batches_done,batches_failed")
    .eq("status", "processing")
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const results: Array<{ scan_id: string; status: string | null; abandoned?: boolean; error?: string }> = [];
  let reconciled = 0;
  let abandoned = 0;
  for (const s of stuck ?? []) {
    const total = (s.batch_count as number | null) ?? 0;
    const done = (s.batches_done as number | null) ?? 0;
    const failedIdx = ((s.batches_failed as number[] | null) ?? []);
    if (total === 0) {
      results.push({ scan_id: s.id as string, status: "no-batches" });
      continue;
    }
    const unreported = done + failedIdx.length < total;
    try {
      if (unreported) {
        await abandonUnreportedBatches(supabase, s.id as string, total, failedIdx);
        abandoned += 1;
      }
      const res = await finalizeScanCore(supabase, s.user_id as string, s.id as string);
      reconciled += 1;
      results.push({ scan_id: s.id as string, status: res.status, ...(unreported ? { abandoned: true } : {}) });
    } catch (e) {
      results.push({ scan_id: s.id as string, status: null, error: (e as Error).message });
    }
  }
  return { examined: (stuck ?? []).length, reconciled, abandoned, results };
}
