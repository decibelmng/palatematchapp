/* eslint-disable no-console */
import { createClient } from "@supabase/supabase-js";
import { recommend, type RatedFp, type BottleFp } from "../src/lib/recommender";

const USER_ID = "e3c4104c-56e7-4b6b-a359-5dc063302951";
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
const sb = createClient(url, key);

const FP_COLS =
  "id,name,producer,region,type,critic_score,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory";

function toBottleFp(b: any): BottleFp {
  return {
    id: b.id,
    name: b.name,
    producer: b.producer,
    region: b.region,
    type: b.type,
    fp: {
      fresh: b.fp_fresh, acid: b.fp_acid, tannin: b.fp_tannin,
      fruit_dark: b.fp_fruit_dark, ripe: b.fp_ripe, oak: b.fp_oak,
      body: b.fp_body, savory: b.fp_savory,
    },
  };
}

async function loadRated(type: "red" | "white"): Promise<RatedFp[]> {
  const { data: ratings, error } = await sb
    .from("ratings")
    .select(`stars, bottle:bottles!inner(${FP_COLS},excluded_from_recs)`)
    .eq("user_id", USER_ID);
  if (error) throw error;
  const { data: canonRows } = await sb
    .from("canon_wines")
    .select("bottle_id,tier")
    .eq("user_id", USER_ID)
    .is("replaced_at", null);
  const tierBy = new Map<string, "canon" | "nemesis">();
  for (const c of canonRows ?? []) tierBy.set(c.bottle_id, c.tier as any);

  return (ratings ?? [])
    .map((r: any) => {
      const b = r.bottle;
      if (!b || b.type !== type || b.excluded_from_recs) return null;
      if (b.fp_body === null || b.fp_body === undefined) return null;
      const tier = tierBy.get(b.id);
      const fp = toBottleFp(b);
      return {
        ...fp,
        stars: r.stars,
        weight: tier ? 3.0 : 1.0,
        canon: tier === "canon",
        nemesis: tier === "nemesis",
      } as RatedFp;
    })
    .filter((x): x is RatedFp => x !== null);
}

async function loadCandidates(type: "red" | "white"): Promise<BottleFp[]> {
  const excluded = new Set<string>();
  const { data: ratings } = await sb
    .from("ratings")
    .select("bottle_id")
    .eq("user_id", USER_ID);
  for (const r of ratings ?? []) excluded.add(r.bottle_id);

  const out: BottleFp[] = [];
  const critics = new Map<string, number | null>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("bottles")
      .select(FP_COLS)
      .eq("type", type)
      .not("fp_body", "is", null)
      .or("excluded_from_recs.is.null,excluded_from_recs.eq.false")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const b of data) {
      if (excluded.has(b.id)) continue;
      out.push(toBottleFp(b));
      critics.set(b.id, b.critic_score);
    }
    if (data.length < PAGE) break;
  }
  (out as any).__critics = critics;
  return out;
}

async function run(type: "red" | "white") {
  const rated = await loadRated(type);
  const cands = await loadCandidates(type);
  const critics = (cands as any).__critics as Map<string, number | null>;
  console.log(`\n=== ${type.toUpperCase()} POOL ===`);
  console.log(`rated=${rated.length} candidates=${cands.length}`);
  const nemeses = rated.filter((r) => r.nemesis).map((r) => r.name);
  console.log(`nemeses: ${nemeses.join(" | ")}`);
  const recs = recommend(rated, cands);
  const vetoed = recs.filter((r) => r.vetoed);
  const contested = recs.filter((r) => r.contested);
  const pct = (n: number) => ((100 * n) / recs.length).toFixed(2) + "%";
  console.log(
    `veto=${vetoed.length} (${pct(vetoed.length)})  contested=${contested.length} (${pct(contested.length)})`,
  );

  // Named acceptance targets (red only)
  if (type === "red") {
    const targets = ["Masseto", "Caymus", "Quilceda", "Earthquake"];
    console.log("\n--- Acceptance: named targets ---");
    for (const q of targets) {
      const hits = recs.filter((r) =>
        r.bottle.name.toLowerCase().includes(q.toLowerCase()),
      );
      // Print first 3 matches per query
      for (const r of hits.slice(0, 3)) {
        const cr = r.contestedReason;
        const vr = r.vetoReason;
        console.log(
          `[${q}] ${r.bottle.name} — vetoed=${r.vetoed} contested=${r.contested}` +
            (vr ? ` d_nem=${vr.distance.toFixed(3)}` : "") +
            (cr
              ? ` d_nem=${cr.nemesisDistance.toFixed(3)} d_love=${cr.positiveDistance.toFixed(3)} → love=${cr.nearestPositive.name}`
              : ""),
        );
      }
    }
  }

  console.log("\n--- Top 10 highest-critic vetoed ---");
  const rankedVetoed = vetoed
    .map((r) => ({ r, cs: critics.get(r.bottle.id) ?? 0 }))
    .sort((a, b) => (b.cs ?? 0) - (a.cs ?? 0))
    .slice(0, 10);
  for (const { r, cs } of rankedVetoed) {
    console.log(
      `  crit=${cs} · ${r.bottle.name} · ${r.bottle.producer ?? ""} · d_nem=${r.vetoReason!.distance.toFixed(3)} · nem=${r.vetoReason!.nemesis.name} · axes=${r.vetoReason!.drivingAxes.join(",")}`,
    );
  }
}

(async () => {
  await run("red");
  await run("white");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
