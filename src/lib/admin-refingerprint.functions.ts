import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { refingerprintCuveeByBottleId, stripYear } from "@/lib/fingerprint-worker";
import { getPourCandidates } from "@/lib/pour.functions";

// NOTE: ADMIN_USER_ID must be set in Lovable Cloud env to the owner's auth user id.
// Any signed-in user whose auth uid does NOT match will get "Not authorized".

const BATCH_SIZE = 15;




export const refingerprintBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const adminId = process.env.ADMIN_USER_ID;
    if (!adminId || context.userId !== adminId) {
      throw new Error("Not authorized");
    }
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Build the priority queue with TARGETED fetches per tier, then group in JS.
    // A single ".limit(N)" over all unstamped bottles is not safe: without an
    // ORDER BY, the slice is arbitrary and can miss the (few) rated / menu ids
    // entirely — which is why the first run returned remaining=0.

    const isDef = (v: number | null) => v != null && Math.abs(v - 0.5) < 0.02;

    // 1. Priority bottle ids: rated + menu (catalog-wide reads → service role).
    const [{ data: rated, error: rErr }, { data: menu, error: mErr }] = await Promise.all([
      supabaseAdmin.from("ratings").select("bottle_id"),
      supabaseAdmin.from("restaurant_wines").select("bottle_id"),
    ]);
    if (rErr) throw new Error(rErr.message);
    if (mErr) throw new Error(mErr.message);
    const ratedIds = new Set<string>((rated ?? []).map((x: any) => x.bottle_id as string));
    const menuIds = new Set<string>((menu ?? []).map((x: any) => x.bottle_id as string));

    // 2. Fetch metadata for those ids to discover the producers we need to expand.
    const priorityIds = Array.from(new Set<string>([...ratedIds, ...menuIds]));
    const producers = new Set<string>();
    for (let i = 0; i < priorityIds.length; i += 500) {
      const chunk = priorityIds.slice(i, i + 500);
      const { data, error } = await supabaseAdmin
        .from("bottles")
        .select("producer")
        .in("id", chunk);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) if (r.producer) producers.add(r.producer as string);
    }

    // 3. Load unstamped bottles: (a+b) all rows for those producers so we group
    // siblings correctly, plus (c) a bounded slice of fully-defaulted rows.
    const rowById = new Map<string, any>();
    const COLS = "id,producer,name,type,region,country,grape,source,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,refingerprinted_at";

    const producerList = Array.from(producers);
    for (let i = 0; i < producerList.length; i += 200) {
      const chunk = producerList.slice(i, i + 200);
      const { data, error } = await supabaseAdmin
        .from("bottles")
        .select(COLS)
        .is("refingerprinted_at", null)
        .in("producer", chunk);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) rowById.set(r.id as string, r);
    }

    // Tier (c): fully-defaulted, bounded slice.
    {
      const { data, error } = await supabaseAdmin
        .from("bottles")
        .select(COLS)
        .is("refingerprinted_at", null)
        .gte("fp_fresh", 0.48).lte("fp_fresh", 0.52)
        .gte("fp_acid", 0.48).lte("fp_acid", 0.52)
        .gte("fp_tannin", 0.48).lte("fp_tannin", 0.52)
        .gte("fp_fruit_dark", 0.48).lte("fp_fruit_dark", 0.52)
        .gte("fp_ripe", 0.48).lte("fp_ripe", 0.52)
        .gte("fp_oak", 0.48).lte("fp_oak", 0.52)
        .gte("fp_body", 0.48).lte("fp_body", 0.52)
        .gte("fp_savory", 0.48).lte("fp_savory", 0.52)
        .limit(2000);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) if (!rowById.has(r.id)) rowById.set(r.id as string, r);
    }

    // 4. Group by cuvée key.
    const groups = new Map<string, {
      key: string;
      representative: any;
      ids: string[];
      allDefault: boolean;
    }>();
    for (const r of rowById.values()) {
      const gp = (r.producer ?? "").toLowerCase();
      const gn = stripYear((r.name ?? "").toLowerCase());
      const gt = (r.type ?? "").toLowerCase();
      const gr = (r.region ?? "").toLowerCase();
      const k = `${gp}|${gn}|${gt}|${gr}`;
      const rowDef = isDef(r.fp_fresh) && isDef(r.fp_acid) && isDef(r.fp_tannin) && isDef(r.fp_fruit_dark)
                  && isDef(r.fp_ripe) && isDef(r.fp_oak) && isDef(r.fp_body) && isDef(r.fp_savory);
      const existing = groups.get(k);
      if (existing) {
        existing.ids.push(r.id);
        existing.allDefault = existing.allDefault && rowDef;
      } else {
        groups.set(k, { key: k, representative: r, ids: [r.id], allDefault: rowDef });
      }
    }

    // 5. Rank groups by tier.
    type Group = { key: string; representative: any; ids: string[]; allDefault: boolean };
    type Ranked = { bucket: 0 | 1 | 2; g: Group };
    const ranked: Ranked[] = [];
    for (const g of groups.values()) {
      const hasRating = g.ids.some((id) => ratedIds.has(id));
      const hasMenu = g.ids.some((id) => menuIds.has(id));
      let bucket: 0 | 1 | 2 | null = null;
      if (hasRating) bucket = 0;
      else if (hasMenu) bucket = 1;
      else if (g.allDefault) bucket = 2;
      if (bucket != null) ranked.push({ bucket, g });
    }
    ranked.sort((a, b) => a.bucket - b.bucket);



    const remaining = ranked.length;
    const batch = ranked.slice(0, BATCH_SIZE);

    let processed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const { g } of batch) {
      // Use the shared worker (seed = first row in group). It re-fetches the
      // group internally, but its "already stamped" and size guards make it
      // safe and idempotent alongside our ranked queue.
      try {
        const result = await refingerprintCuveeByBottleId(g.ids[0], supabaseAdmin);
        if ("ok" in result) {
          processed += 1;
        } else {
          skipped += 1;
          errors.push(result.reason);
        }
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (/AI credits exhausted/i.test(msg) || /Rate limited/i.test(msg)) {
          throw new Error(msg);
        }
        skipped += 1;
        errors.push(msg);
      }
    }

    return {
      processed,
      skipped,
      remaining: Math.max(0, remaining - processed),
      errors: errors.slice(0, 5),
    };
  });
