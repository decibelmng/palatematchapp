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
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(userId: string) {
  const adminId = process.env.ADMIN_USER_ID;
  if (!adminId || userId !== adminId) throw new Error("Not authorized");
}

export type RemediationClass = "unrated" | "confirm-existing" | "confirm-resolve";

export type RemediationItem = {
  scan_wine_id: string;
  scan_id: string;
  user_id: string;
  scanned_at: string | null;
  scanned_vintage: number;
  scanned_producer: string | null;
  scanned_cuvee: string | null;
  wrong_bottle_id: string;
  wrong_name: string;
  wrong_producer: string | null;
  wrong_region: string | null;
  wrong_type: string;
  wrong_vintage: number;
  years_apart: number;
  correct_bottle_id: string | null;
  correct_name: string | null;
  /** The scan owner's own rating on the wrongly matched bottle, if any. */
  stars: number | null;
  /** Someone else's rating sits on this bottle — never moved from here. */
  other_ratings: number;
  benchmark_tier: "canon" | "nemesis" | null;
  prediction_rows: number;
  klass: RemediationClass;
};

type SW = {
  id: string; scan_id: string; user_id: string; vintage: number | null;
  producer: string | null; cuvee: string | null; wine_type: string | null;
  matched_bottle_id: string | null; created_at: string | null;
};
type B = {
  id: string; name: string; producer: string | null; region: string | null;
  type: string; vintage: number | null; grape: string | null; country: string | null;
};

async function buildQueue(admin: any): Promise<RemediationItem[]> {
  const { data: lines, error: e1 } = await admin
    .from("scan_wines")
    .select("id,scan_id,user_id,vintage,producer,cuvee,wine_type,matched_bottle_id,created_at")
    .not("matched_bottle_id", "is", null)
    .not("vintage", "is", null)
    .limit(5000);
  if (e1) throw new Error(e1.message);
  const rows = (lines ?? []) as SW[];

  const ids = [...new Set(rows.map((r) => r.matched_bottle_id!))];
  const bottles = new Map<string, B>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin
      .from("bottles")
      .select("id,name,producer,region,type,vintage,grape,country")
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const b of (data ?? []) as B[]) bottles.set(b.id, b);
  }

  const bad = rows.filter((r) => {
    const b = bottles.get(r.matched_bottle_id!);
    return b?.vintage != null && r.vintage != null && b.vintage !== r.vintage;
  });
  if (bad.length === 0) return [];

  const wrongIds = [...new Set(bad.map((r) => r.matched_bottle_id!))];

  // Judgment attached to the wrong bottle.
  const { data: rts } = await admin
    .from("ratings").select("user_id,bottle_id,stars").in("bottle_id", wrongIds);
  const { data: cws } = await admin
    .from("canon_wines").select("user_id,bottle_id,tier").in("bottle_id", wrongIds).is("replaced_at", null);
  const { data: pos } = await admin
    .from("prediction_outcomes").select("user_id,bottle_id").in("bottle_id", wrongIds);

  const ratingKey = (u: string, b: string) => `${u}|${b}`;
  const ratings = new Map<string, number>();
  const ratingsByBottle = new Map<string, number>();
  for (const r of (rts ?? []) as any[]) {
    ratings.set(ratingKey(r.user_id, r.bottle_id), r.stars);
    ratingsByBottle.set(r.bottle_id, (ratingsByBottle.get(r.bottle_id) ?? 0) + 1);
  }
  const tiers = new Map<string, "canon" | "nemesis">();
  for (const c of (cws ?? []) as any[]) tiers.set(ratingKey(c.user_id, c.bottle_id), c.tier);
  const preds = new Map<string, number>();
  for (const p of (pos ?? []) as any[]) {
    const k = ratingKey(p.user_id, p.bottle_id);
    preds.set(k, (preds.get(k) ?? 0) + 1);
  }

  // Does the correct vintage already exist? Same producer, same type, that year.
  const correct = new Map<string, B | null>();
  for (const r of bad) {
    const b = bottles.get(r.matched_bottle_id!)!;
    const ck = `${b.producer ?? ""}|${b.type}|${r.vintage}`;
    if (correct.has(ck)) continue;
    if (!b.producer) { correct.set(ck, null); continue; }
    const { data } = await admin
      .from("bottles")
      .select("id,name,producer,region,type,vintage,grape,country")
      .eq("type", b.type)
      .eq("vintage", r.vintage)
      .ilike("producer", b.producer)
      .limit(1);
    correct.set(ck, ((data ?? []) as B[])[0] ?? null);
  }

  return bad.map((r) => {
    const b = bottles.get(r.matched_bottle_id!)!;
    const ck = `${b.producer ?? ""}|${b.type}|${r.vintage}`;
    const c = correct.get(ck) ?? null;
    const k = ratingKey(r.user_id, b.id);
    const stars = ratings.get(k) ?? null;
    const tier = tiers.get(k) ?? null;
    const predictionRows = preds.get(k) ?? 0;
    const ownRating = stars != null ? 1 : 0;
    const carriesJudgment = stars != null || tier != null || predictionRows > 0;
    return {
      scan_wine_id: r.id,
      scan_id: r.scan_id,
      user_id: r.user_id,
      scanned_at: r.created_at,
      scanned_vintage: r.vintage!,
      scanned_producer: r.producer,
      scanned_cuvee: r.cuvee,
      wrong_bottle_id: b.id,
      wrong_name: b.name,
      wrong_producer: b.producer,
      wrong_region: b.region,
      wrong_type: b.type,
      wrong_vintage: b.vintage!,
      years_apart: Math.abs(r.vintage! - b.vintage!),
      correct_bottle_id: c?.id ?? null,
      correct_name: c?.name ?? null,
      stars,
      other_ratings: (ratingsByBottle.get(b.id) ?? 0) - ownRating,
      benchmark_tier: tier,
      prediction_rows: predictionRows,
      klass: !carriesJudgment ? "unrated" : c ? "confirm-existing" : "confirm-resolve",
    } satisfies RemediationItem;
  });
}

export const vintageRemediationQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
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

async function stampReason(admin: any, scanWineId: string, tag: string) {
  const { data } = await admin.from("scan_wines").select("match_reasons").eq("id", scanWineId).single();
  const prev = Array.isArray(data?.match_reasons) ? data!.match_reasons : [];
  await admin.from("scan_wines").update({ match_reasons: [...prev, tag] } as never).eq("id", scanWineId);
}

/**
 * The 110 lines with nothing attached. No judgment to protect, so the corrected
 * matcher's answer is written straight in: the correct-vintage row where one
 * exists, otherwise nothing — an honest unmatched line beats a wrong bottle.
 */
export const vintageRematchUnrated = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
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
      const { resolveOrCreateOnDemandCore } = await import("./on-demand-bottle.functions");
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
