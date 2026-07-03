import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callFingerprintGateway } from "@/lib/fingerprint-prompt";

// NOTE: ADMIN_USER_ID must be set in Lovable Cloud env to the owner's auth user id.
// Any signed-in user whose auth uid does NOT match will get "Not authorized".

const BATCH_SIZE = 15;

type GroupRow = {
  gp: string;
  gn: string;
  gt: string;
  gr: string;
  representative_id: string;
  producer: string | null;
  name: string;
  type: string;
  region: string | null;
  country: string | null;
  grape: string | null;
  ids: string[];
};

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

    // Build the priority queue in JS: fetch unstamped bottles, group them,
    // then check rating/menu presence for their ids.


    // Fetch candidates (all bottles) with only needed columns.
    // For scale safety, cap at 5000 rows per invocation of the priority build.
    const { data: rows, error: rowsErr } = await supabaseAdmin
      .from("bottles")
      .select("id,producer,name,type,region,country,grape,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,refingerprinted_at")
      .is("refingerprinted_at", null)
      .limit(20000);
    if (rowsErr) throw new Error(rowsErr.message);

    // Group in JS with the same key.
    const stripYear = (s: string) => s.replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
    const groups = new Map<string, {
      key: string;
      representative: any;
      ids: string[];
      allDefault: boolean;
    }>();
    for (const r of rows ?? []) {
      const gp = (r.producer ?? "").toLowerCase();
      const gn = stripYear((r.name ?? "").toLowerCase());
      const gt = (r.type ?? "").toLowerCase();
      const gr = (r.region ?? "").toLowerCase();
      const k = `${gp}|${gn}|${gt}|${gr}`;
      const isDef = (v: number | null) => v != null && Math.abs(v - 0.5) < 0.02;
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
    const allIds = Array.from(groups.values()).flatMap(g => g.ids);

    // Load rating/menu presence for those ids.
    const ratedIds = new Set<string>();
    const menuIds = new Set<string>();
    if (allIds.length > 0) {
      // Chunk .in() calls to avoid URL limits (Postgrest ~2KB URL).
      for (let i = 0; i < allIds.length; i += 500) {
        const chunk = allIds.slice(i, i + 500);
        const [{ data: rr }, { data: mm }] = await Promise.all([
          supabaseAdmin.from("ratings").select("bottle_id").in("bottle_id", chunk),
          supabaseAdmin.from("restaurant_wines").select("bottle_id").in("bottle_id", chunk),
        ]);
        for (const x of rr ?? []) ratedIds.add(x.bottle_id as string);
        for (const x of mm ?? []) menuIds.add(x.bottle_id as string);
      }
    }

    // Rank groups.
    type Ranked = { bucket: 0 | 1 | 2; g: typeof groups extends Map<any, infer V> ? V : never };
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
      const rep = g.representative;
      try {
        const { fp, ax_sweet } = await callFingerprintGateway(
          {
            producer: rep.producer ?? "",
            name: stripYear(rep.name ?? ""),
            type: rep.type ?? "red",
            region: rep.region,
            country: rep.country,
            grape: rep.grape,
            vintage: null,
          },
          key,
        );
        // Write to every row in the group.
        const { error: uErr } = await supabaseAdmin
          .from("bottles")
          .update({
            fp_fresh: fp.fresh,
            fp_acid: fp.acid,
            fp_tannin: fp.tannin,
            fp_fruit_dark: fp.fruit_dark,
            fp_ripe: fp.ripe,
            fp_oak: fp.oak,
            fp_body: fp.body,
            fp_savory: fp.savory,
            ax_body: fp.body,
            ax_fruit_char: fp.savory,
            ax_tannin: fp.tannin,
            ax_acidity: fp.acid,
            ax_sweet,
            source: (rep.source ? `${rep.source}; refingerprinted (cuvée-level)` : "refingerprinted (cuvée-level)"),
            refingerprinted_at: new Date().toISOString(),
          })
          .in("id", g.ids);
        if (uErr) {
          skipped += 1;
          errors.push(uErr.message);
          continue;
        }
        processed += 1;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        // Bubble up fatal auth/credit errors so the UI can stop the loop.
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
