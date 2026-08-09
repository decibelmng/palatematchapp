/**
 * Vintage-mismatch remediation. ADMIN ONLY.
 *
 * The old matcher was vintage-blind, so 124 scan lines resolved to a bottle
 * from a different year — sometimes fifteen years apart, which is a different
 * wine. Fixing the matcher does not fix the rows it already wrote.
 *
 * The rule that shapes every function here: a rating is the owner's judgment
 * attached to a wine they may not have drunk. Lines carrying no judgment are
 * rewritten freely. Anything carrying a rating, a benchmark, or a prediction
 * moves only on an explicit confirm, one card at a time, and never for a rating
 * that belongs to somebody else.
 *
 * prediction_outcomes is append-only by design: a repoint writes a superseding
 * row, it never edits or deletes the original.
 *
 * A scanned line is evidence of what a list offered, never proof of what was
 * poured. So a mismatch is a QUESTION, not a correction: the owner picks which
 * bottle they drank, and "leave it" is a real answer. Only the "scanned year"
 * answer moves data; the other two stamp the line and touch nothing else.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveOrCreateOnDemandCore } from "./on-demand-bottle.functions";
export type { RemediationClass, RemediationItem } from "./vintage-remediation.server";

export const vintageRemediationQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin, buildQueue } = await import("./vintage-remediation.server");
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const items = await buildQueue(supabaseAdmin);
    return {
      items,
      counts: {
        total: items.length,
        unrated: items.filter((i) => i.klass === "unrated").length,
        confirmExisting: items.filter((i) => i.klass === "confirm-existing").length,
        confirmResolve: items.filter((i) => i.klass === "confirm-resolve").length,
      },
    };
  });

/**
 * The 110 lines with nothing attached. No judgment to protect, so the corrected
 * matcher's answer is written straight in: the correct-vintage row where one
 * exists, otherwise nothing — an honest unmatched line beats a wrong bottle.
 */
export const vintageRematchUnrated = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertAdmin, buildQueue, stampReason } = await import("./vintage-remediation.server");
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const items = (await buildQueue(supabaseAdmin)).filter((i) => i.klass === "unrated");
    let repointed = 0;
    let unmatched = 0;
    for (const i of items) {
      const target = i.correct_bottle_id;
      const { error } = await supabaseAdmin
        .from("scan_wines")
        .update({ matched_bottle_id: target, match_score: target ? null : null } as never)
        .eq("id", i.scan_wine_id);
      if (error) continue;
      await stampReason(
        supabaseAdmin,
        i.scan_wine_id,
        target
          ? `remediation:vintage_repointed:${i.wrong_vintage}->${i.scanned_vintage}`
          : `remediation:vintage_unmatched:${i.wrong_vintage}_was_wrong_year`,
      );
      if (target) repointed++; else unmatched++;
    }
    return { considered: items.length, repointed, unmatched };
  });

/**
 * One confirmed repoint. Nothing here runs without a tap.
 *
 * A rating belonging to another person is refused outright — remediation is not
 * a licence to move somebody else's judgment.
 */
export const vintageConfirmRepoint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: { scanWineId: string; resolveOnDemand?: boolean }) => raw)
  .handler(async ({ context, data }) => {
    const { assertAdmin, buildQueue, stampReason } = await import("./vintage-remediation.server");
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const item = (await buildQueue(supabaseAdmin)).find((i) => i.scan_wine_id === data.scanWineId);
    if (!item) throw new Error("That line no longer reads as a vintage mismatch — reload the queue.");
    if (item.stars != null && item.user_id !== context.userId) {
      throw new Error("That rating belongs to another person. Their judgment does not move from here.");
    }

    // 1) The bottle for the year that was actually on the list.
    let targetId = item.correct_bottle_id;
    let created = false;
    if (!targetId) {
      if (!data.resolveOnDemand) throw new Error("No row for that year yet — confirm the on-demand resolve.");
      const key = process.env.LOVABLE_API_KEY;
      if (!key) throw new Error("Missing LOVABLE_API_KEY");
      const res = await resolveOrCreateOnDemandCore(context.supabase as any, context.userId, key, {
        producer: item.wrong_producer ?? item.scanned_producer ?? "",
        name: item.scanned_cuvee ?? item.wrong_name,
        type: item.wrong_type as any,
        region: item.wrong_region,
        vintage: item.scanned_vintage,
      } as any);
      targetId = res.bottle_id;
      created = res.created;
    }
    if (!targetId) throw new Error("Could not resolve the correct vintage.");

    // 2) Repoint the scan line.
    await supabaseAdmin
      .from("scan_wines")
      .update({ matched_bottle_id: targetId } as never)
      .eq("id", item.scan_wine_id);
    await stampReason(
      supabaseAdmin,
      item.scan_wine_id,
      `remediation:vintage_confirmed:${item.wrong_vintage}->${item.scanned_vintage}`,
    );

    // 3) Move the rating, if there is one. Upsert first, delete second: the
    //    ratings-delete trigger retires the old benchmark, so the new row must
    //    already exist before the old one goes.
    let movedRating = false;
    let benchmarkRestored: string | null = null;
    if (item.stars != null) {
      const { data: old } = await supabaseAdmin
        .from("ratings")
        .select("stars,note,photo_path,photo_shared,created_at")
        .eq("user_id", item.user_id)
        .eq("bottle_id", item.wrong_bottle_id)
        .maybeSingle();
      const stars = (old as any)?.stars ?? item.stars;
      const { error: upErr } = await supabaseAdmin
        .from("ratings")
        .upsert(
          {
            user_id: item.user_id,
            bottle_id: targetId,
            stars,
            note: (old as any)?.note ?? null,
            photo_path: (old as any)?.photo_path ?? null,
            photo_shared: (old as any)?.photo_shared ?? false,
            created_at: (old as any)?.created_at ?? new Date().toISOString(),
          } as never,
          { onConflict: "user_id,bottle_id" },
        );
      if (upErr) throw new Error(`Rating did not move: ${upErr.message}`);
      await supabaseAdmin
        .from("ratings").delete().eq("user_id", item.user_id).eq("bottle_id", item.wrong_bottle_id);
      movedRating = true;

      // 4) prediction_outcomes: append a superseding row, never edit. predicted
      //    is unknown at repoint time, so null_reason records why.
      await supabaseAdmin.from("prediction_outcomes").insert({
        user_id: item.user_id,
        bottle_id: targetId,
        stars,
        predicted: null,
        delta: null,
        null_reason: "not_attempted",
        source: "other",
        scan_id: item.scan_id,
        scan_wine_id: item.scan_wine_id,
        fp_pipeline: "vintage_remediation",
      } as never);

      // 5) The benchmark. The delete above retired the old row; re-set it on the
      //    correct bottle as the owner, so anchor weight follows the wine they
      //    actually drank.
      if (item.benchmark_tier) {
        const { error: bErr } = await context.supabase.rpc("set_benchmark" as never, {
          p_bottle_id: targetId, p_tier: item.benchmark_tier, p_action: "set",
        } as never);
        if (bErr) throw new Error(`Rating moved but the benchmark did not: ${bErr.message}`);
        benchmarkRestored = item.benchmark_tier;
      }
    }

    return { targetId, created, movedRating, benchmarkRestored };
  });


/**
 * The two answers that move NOTHING. Recorded so the card stops asking, and so
 * the history says which way it was settled.
 *
 * - "current": the rating is on the bottle they drank; the list simply offered a
 *   different year. Silver Oak's 2006 is this case.
 * - "leave": undecided. A rating on a plausible bottle beats a rating moved on a
 *   guess, so this is the default and it is preserved as such.
 */
export const vintageSettleWithoutMoving = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: { scanWineId: string; choice: "current" | "leave" }) => raw)
  .handler(async ({ context, data }) => {
    const { assertAdmin, buildQueue, stampReason } = await import("./vintage-remediation.server");
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const item = (await buildQueue(supabaseAdmin)).find((i) => i.scan_wine_id === data.scanWineId);
    if (!item) throw new Error("That line no longer reads as a vintage mismatch — reload the queue.");
    if (item.stars != null && item.user_id !== context.userId) {
      throw new Error("That rating belongs to another person. Their judgment does not move from here.");
    }
    await stampReason(
      supabaseAdmin,
      item.scan_wine_id,
      data.choice === "current"
        ? `remediation:vintage_kept:${item.wrong_vintage}_confirmed_poured`
        : `remediation:vintage_undecided:${item.wrong_vintage}_vs_${item.scanned_vintage}`,
    );
    // No rating, benchmark, prediction, or match target is written. Deliberate.
    return { moved: false as const, choice: data.choice };
  });
