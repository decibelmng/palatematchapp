/**
 * Ranking-reversal check on the real engine code path.
 *
 * Ranks the identical 40-wine pilot cohort against the owner's real red palate
 * three ways — v1 frozen priors, v3 on 2.5-flash, v3 on 3.6-flash — changing
 * ONLY the candidate fingerprints. The rated set (the palate itself) is held at
 * its live values in all three runs, so any rank movement is attributable to
 * the candidate re-fingerprint and nothing else.
 *
 * READ-ONLY. Also reports local support: candidates with no rated wine inside
 * the bandwidth, which fall back to shrinkage rather than fabricated locality.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  recommend, buildTypeContext, distanceInContext,
  RAX, RETIRED_AXES, BENCHMARK_WEIGHT,
  type RatedFp, type BottleFp, type FpKey, type FpVec,
} from "@/lib/recommender";

const OWNER = "e3c4104c-56e7-4b6b-a359-5dc063302951";
const AXES = RAX;
const ACTIVE = AXES.filter((a) => !RETIRED_AXES.includes(a));

const psql = (sql: string) =>
  execFileSync("psql", ["-At", "-F", "\x1f", "-c", sql], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).map((l) => l.split("\x1f"));

// ── the palate: owner's rated reds at live values ──────────────────────────
const ratedRows = psql(`
  select r.bottle_id, b.name, r.stars,
         coalesce(cw.tier, '') as tier,
         ${AXES.map((a) => `b.fp_${a}_prior`).join(", ")}
  from ratings r
  join bottles b on b.id = r.bottle_id
  left join canon_wines cw on cw.rating_id = r.id and cw.replaced_at is null
  where r.user_id = '${OWNER}' and b.type = 'red'`);

const rated: RatedFp[] = ratedRows.map((r) => {
  const tier = r[3];
  const benchmark = tier === "canon" || tier === "benchmark";
  const nemesis = tier === "nemesis" || tier === "dealbreaker";
  const fp: FpVec = {};
  AXES.forEach((a, i) => { fp[a] = Number(r[4 + i]); });
  return {
    id: r[0], name: r[1], type: "red" as const, fp,
    stars: Number(r[2]), canon: benchmark, nemesis,
    weight: benchmark || nemesis ? BENCHMARK_WEIGHT : 1,
  };
});
console.log(`palate: ${rated.length} rated reds  `
  + `(${rated.filter((r) => r.canon).length} benchmarks, ${rated.filter((r) => r.nemesis).length} dealbreakers)`);

// ── the candidates: the same 40 wines under three fingerprint sources ──────
type Pilot = {
  id: string; name: string; producer: string;
  prior: Record<string, number>; v3: Record<string, number | null>;
};
const p25: Pilot[] = JSON.parse(readFileSync("/tmp/pilot-v3.json", "utf8"));
const p36: Pilot[] = JSON.parse(readFileSync("/tmp/pilot-v3-36.json", "utf8"));
const by36 = new Map(p36.map((r) => [r.id, r]));

const toFp = (src: Record<string, number | null>): FpVec => {
  const fp: FpVec = {};
  for (const a of AXES) {
    const v = src[a];
    if (v !== null && v !== undefined) fp[a] = v;
  }
  return fp;
};

const variants: Array<[string, (r: Pilot) => FpVec]> = [
  ["v1 priors", (r) => toFp(r.prior)],
  ["v3 2.5-flash", (r) => toFp(r.v3)],
  ["v3 3.6-flash", (r) => toFp(by36.get(r.id)!.v3)],
];

const WATCH = ["Cardinale", "Colgin", "Macauley", "Araujo"];
const ranks: Record<string, Record<string, string>> = {};

for (const [label, pick] of variants) {
  const cands: BottleFp[] = p25.map((r) => ({
    id: r.id, name: r.name, producer: r.producer, type: "red" as const, fp: pick(r),
  }));
  const recs = recommend(rated, cands);
  const n = recs.length;
  console.log(`\n=== ${label} — ranked ${n}/${cands.length} candidates ===`);
  recs.slice(0, 5).forEach((r, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${r.predicted.toFixed(2)}  ${r.bottle.name.slice(0, 58)}`));
  console.log("       …");
  recs.slice(-5).forEach((r, i) =>
    console.log(`  ${String(n - 4 + i).padStart(2)}. ${r.predicted.toFixed(2)}  ${r.bottle.name.slice(0, 58)}`));

  for (const w of WATCH) {
    const hits = recs.map((r, i) => ({ r, i }))
      .filter(({ r }) => (r.bottle.producer ?? "").toLowerCase().includes(w.toLowerCase()));
    ranks[w] ??= {};
    ranks[w][label] = hits.length
      ? hits.map(({ r, i }) => `#${i + 1}/${n} (${r.predicted.toFixed(2)}${
          r.vetoed ? " VETO" : r.contested ? " contested" : ""})`).join(", ")
      : "absent";
  }

  // local support: any rated wine inside the bandwidth
  const ctx = buildTypeContext(rated, "red");
  if (ctx) {
    const h = ctx.h;
    let none = 0;
    for (const c of cands) {
      const near = rated.some((r) => {
        const d = distanceInContext(c.fp, r.fp, ctx);
        return Number.isFinite(d) && d <= h;
      });
      if (!near) none++;
    }
    console.log(`  bandwidth h=${h.toFixed(3)} — candidates with no rated wine inside h: ${none}/${cands.length}`);
  }
}

console.log("\n=== RANKING REVERSAL — watch list ===");
for (const w of WATCH) {
  console.log(`${w.padEnd(11)}` + variants.map(([l]) => `${l}: ${ranks[w][l]}`).join("   |   "));
}
console.log(`\nactive axes: ${ACTIVE.join(", ")} (fresh retired)`);
