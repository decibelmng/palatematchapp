import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type DisputeRow = {
  user_id: string;
  username: string | null;
  stars: number;
  predicted: number;
  delta: number;
  note: string | null;
  is_anchor_holder: boolean;
  weight: number;
  created_at: string;
};

export type DisputedBottle = {
  bottle_id: string;
  name: string;
  producer: string | null;
  region: string | null;
  vintage: number | null;
  type: string | null;
  fp: {
    fresh: number; acid: number; tannin: number; fruit_dark: number;
    ripe: number; oak: number; body: number; savory: number;
  };
  dispute_count: number;
  total_weight: number;
  /** Ranking score = count × Σ(disputer weights). */
  score: number;
  disputes: DisputeRow[];
};

/** Admin-only: list bottles with active fingerprint disputes, ordered by
 *  (dispute_count × Σ disputer anchor weights). A user holding ANY active
 *  Canon/Nemesis carries weight 3 (BENCHMARK_WEIGHT); otherwise weight 1. */
export const listDisputedFingerprints = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DisputedBottle[]> => {
    const adminId = process.env.ADMIN_USER_ID;
    if (!adminId || context.userId !== adminId) {
      throw new Error("Not authorized");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pull every active dispute.
    const { data: disputes, error: dErr } = await supabaseAdmin
      .from("fp_disputes")
      .select("user_id,bottle_id,stars,predicted,delta,created_at");
    if (dErr) throw new Error(dErr.message);
    const rows = (disputes ?? []) as Array<{
      user_id: string; bottle_id: string; stars: number;
      predicted: number; delta: number; created_at: string;
    }>;
    if (rows.length === 0) return [];

    const bottleIds = Array.from(new Set(rows.map((r) => r.bottle_id)));
    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));

    const [bRes, cRes, pRes, nRes] = await Promise.all([
      supabaseAdmin.from("bottles")
        .select("id,name,producer,region,vintage,type,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,fp_dispute_count,tasting_note")
        .in("id", bottleIds),
      supabaseAdmin.from("canon_wines")
        .select("user_id").in("user_id", userIds).is("replaced_at", null),
      supabaseAdmin.from("profiles").select("id,username,display_name").in("id", userIds),
      // Rater notes live on the bottle's own tasting_note only when they authored it;
      // there's no per-rating note table, so we leave note null for now.
      Promise.resolve({ data: [], error: null }),
    ]);
    if (bRes.error) throw new Error(bRes.error.message);
    if (cRes.error) throw new Error(cRes.error.message);
    if (pRes.error) throw new Error(pRes.error.message);
    void nRes;

    const anchorHolders = new Set<string>();
    for (const c of (cRes.data ?? []) as Array<{ user_id: string }>) anchorHolders.add(c.user_id);

    const nameByUser = new Map<string, string>();
    for (const p of (pRes.data ?? []) as Array<{ id: string; username: string | null; display_name: string | null }>) {
      nameByUser.set(p.id, p.display_name ?? p.username ?? p.id.slice(0, 8));
    }

    const bottleById = new Map<string, any>();
    for (const b of (bRes.data ?? []) as any[]) bottleById.set(b.id, b);

    // Group rows by bottle.
    const grouped = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = grouped.get(r.bottle_id) ?? [];
      arr.push(r); grouped.set(r.bottle_id, arr);
    }

    const BENCHMARK_WEIGHT = 3;
    const out: DisputedBottle[] = [];
    for (const [bid, drows] of grouped) {
      const b = bottleById.get(bid);
      if (!b) continue;
      const disputes: DisputeRow[] = drows.map((r) => {
        const holder = anchorHolders.has(r.user_id);
        return {
          user_id: r.user_id,
          username: nameByUser.get(r.user_id) ?? null,
          stars: r.stars,
          predicted: r.predicted,
          delta: r.delta,
          note: null,
          is_anchor_holder: holder,
          weight: holder ? BENCHMARK_WEIGHT : 1,
          created_at: r.created_at,
        };
      });
      const totalWeight = disputes.reduce((s, d) => s + d.weight, 0);
      out.push({
        bottle_id: bid,
        name: b.name,
        producer: b.producer,
        region: b.region,
        vintage: b.vintage,
        type: b.type,
        fp: {
          fresh: b.fp_fresh, acid: b.fp_acid, tannin: b.fp_tannin, fruit_dark: b.fp_fruit_dark,
          ripe: b.fp_ripe, oak: b.fp_oak, body: b.fp_body, savory: b.fp_savory,
        },
        dispute_count: disputes.length,
        total_weight: totalWeight,
        score: disputes.length * totalWeight,
        disputes,
      });
    }

    out.sort((a, b) => b.score - a.score);
    return out;
  });
