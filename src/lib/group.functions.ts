import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RAX, recommend, type FpKey, type RatedFp, type BottleFp, type WineType } from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";

const FpSchema = z.object({
  fresh: z.number(), acid: z.number(), tannin: z.number(), fruit_dark: z.number(),
  ripe: z.number(), oak: z.number(), body: z.number(), savory: z.number(),
});

const WineTypeSchema = z.enum(["red", "white", "sparkling", "rose", "dessert"]);

const CandidateSchema = z.object({
  id: z.string(),                        // client-side id (bottle id or scan slot key)
  name: z.string(),
  producer: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  type: WineTypeSchema,
  fp: FpSchema,
});

const InputSchema = z.object({
  friend_ids: z.array(z.string().uuid()).max(6),
  candidates: z.array(CandidateSchema).max(500),
});

export type GroupPerPerson = {
  user_id: string;
  display_name: string;
  predicted: number;
  n_ratings_same_type: number;
  still_learning: boolean;      // < 3 same-type ratings
  contributed_min: number;      // predicted after floor-3.0 rule
};

export type GroupScored = {
  candidate_id: string;
  per_person: GroupPerPerson[];
  group_min: number;   // used for ranking (uses contributed_min per person)
  group_avg: number;   // simple mean of raw predicted
};

async function loadMemberRatings(admin: any, userId: string): Promise<RatedFp[]> {
  const { data: ratings, error: rErr } = await admin
    .from("ratings")
    .select("bottle_id, stars")
    .eq("user_id", userId);
  if (rErr) throw new Error(rErr.message);
  if (!ratings || ratings.length === 0) return [];
  const ids = Array.from(new Set(ratings.map((r: any) => r.bottle_id as string)));
  const bottles: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await admin
      .from("bottles")
      .select("id,name,producer,region,type,vintage,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory")
      .in("id", chunk);
    if (error) throw new Error(error.message);
    bottles.push(...(data ?? []));
  }
  const byId = new Map(bottles.map((b) => [b.id, b]));
  const starsById = new Map(ratings.map((r: any) => [r.bottle_id, r.stars]));

  const raw: (RatedFp & { vintage: number | null })[] = [];
  for (const [id, b] of byId) {
    const stars = starsById.get(id);
    if (typeof stars !== "number") continue;
    const t = ((b.type ?? "red").toLowerCase()) as WineType;
    raw.push({
      id: b.id,
      name: b.name,
      producer: b.producer,
      region: b.region,
      type: t,
      stars,
      vintage: b.vintage ?? null,
      fp: {
        fresh: b.fp_fresh, acid: b.fp_acid, tannin: b.fp_tannin, fruit_dark: b.fp_fruit_dark,
        ripe: b.fp_ripe, oak: b.fp_oak, body: b.fp_body, savory: b.fp_savory,
      },
    });
  }
  const agg = aggregateRated(raw);
  return agg.map((c) => ({
    id: c.id, name: c.name, producer: c.producer, region: c.region,
    type: c.type, fp: c.fp, stars: c.stars,
  }));
}

export const groupPredict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GroupScored[]> => {
    const { supabase, userId } = context;

    // 1. Verify every friend_id has an accepted friendship with the caller.
    const uniqueFriends = Array.from(new Set(data.friend_ids)).filter((id) => id !== userId);
    if (uniqueFriends.length > 0) {
      const { data: fRows, error: fErr } = await supabase
        .from("friendships")
        .select("requester_id, addressee_id, status")
        .eq("status", "accepted")
        .or(
          uniqueFriends
            .map(
              (fid) =>
                `and(requester_id.eq.${userId},addressee_id.eq.${fid}),and(requester_id.eq.${fid},addressee_id.eq.${userId})`,
            )
            .join(","),
        );
      if (fErr) throw new Error(fErr.message);
      const okSet = new Set<string>();
      for (const r of fRows ?? []) {
        okSet.add(r.requester_id === userId ? r.addressee_id : r.requester_id);
      }
      for (const fid of uniqueFriends) {
        if (!okSet.has(fid)) throw new Error("Not connected with one of the selected friends.");
      }
    }

    // 2. Load display names for the group.
    const groupIds = [userId, ...uniqueFriends];
    const { data: profs, error: pErr } = await supabase
      .from("profiles")
      .select("id, username, display_name")
      .in("id", groupIds);
    if (pErr) throw new Error(pErr.message);
    const nameById = new Map(
      (profs ?? []).map((p) => [p.id, p.display_name || p.username || "friend"]),
    );

    // 3. Load each member's rated wines using the SERVICE-ROLE client
    //    (bypasses RLS — required to read friends' ratings after friendship verification).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const memberRatings = new Map<string, RatedFp[]>();
    for (const uid of groupIds) {
      memberRatings.set(uid, await loadMemberRatings(supabaseAdmin, uid));
    }

    // 4. Score each candidate for every member.
    const candidates: BottleFp[] = data.candidates.map((c) => ({
      id: c.id,
      name: c.name,
      producer: c.producer ?? null,
      region: c.region ?? null,
      type: c.type as WineType,
      fp: c.fp as Record<FpKey, number>,
    }));

    const perMemberRecs = new Map<string, Map<string, number>>();
    const sameTypeCount = new Map<string, Map<WineType, number>>();
    for (const uid of groupIds) {
      const rated = memberRatings.get(uid) ?? [];
      const byType = new Map<WineType, number>();
      for (const r of rated) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
      sameTypeCount.set(uid, byType);

      // Run the recommender with restrictToRatedTypes:false so unknown-type
      // candidates still get a neutral score (they'll be treated as
      // "still learning" via the same-type count check below).
      const recs = rated.length > 0
        ? recommend(rated, candidates, { restrictToRatedTypes: false })
        : [];
      const map = new Map<string, number>();
      for (const r of recs) map.set(r.bottle.id, r.predicted);
      perMemberRecs.set(uid, map);
    }

    // 5. Assemble per-candidate results, applying the "still learning" floor.
    const out: GroupScored[] = candidates.map((cand) => {
      const per: GroupPerPerson[] = groupIds.map((uid) => {
        const nSame = sameTypeCount.get(uid)?.get(cand.type) ?? 0;
        const stillLearning = nSame < 3;
        const raw = perMemberRecs.get(uid)?.get(cand.id);
        // No prediction possible (no ratings at all, or no same-type ratings): neutral 3.0.
        const predicted = typeof raw === "number" && !Number.isNaN(raw) ? raw : 3.0;
        const contributed = stillLearning ? Math.max(predicted, 3.0) : predicted;
        return {
          user_id: uid,
          display_name: nameById.get(uid) ?? "friend",
          predicted,
          n_ratings_same_type: nSame,
          still_learning: stillLearning,
          contributed_min: contributed,
        };
      });
      const group_min = Math.min(...per.map((p) => p.contributed_min));
      const group_avg = per.reduce((s, p) => s + p.predicted, 0) / per.length;
      return { candidate_id: cand.id, per_person: per, group_min, group_avg };
    });

    // Sort by group_min desc, tiebreak group_avg desc.
    out.sort((a, b) => (b.group_min - a.group_min) || (b.group_avg - a.group_avg));
    return out;
  });
