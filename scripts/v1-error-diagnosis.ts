/**
 * Where the 1.2-star error comes from. DIAGNOSIS ONLY — changes no engine code.
 *
 * Leave-one-out over the rated reds on the v3 shadow columns, current active
 * 7-axis set, plus the null model (predict the per-type mean of the remainder)
 * as the floor every arm has to beat.
 *
 * Run: bun scripts/axis-error-diagnosis.ts
 */
import {
  recommend,
  buildTypeContext,
  distanceInContext,
  type FpKey,
  type FpVec,
  type RatedFp,
  type WineType,
} from "../src/lib/recommender";

const AX7: FpKey[] = ["acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"];

type Row = {
  id: string; name: string; producer: string | null; region: string | null;
  vintage: number | null; type: string; stars: number; scored: boolean;
} & { [K in "acid" | "tannin" | "fruit_dark" | "ripe" | "oak" | "body" | "savory"]: number | null };

const rated: Row[] = require("/tmp/axis-exp/rated_v1.json");

const fpOf = (r: Row): FpVec => {
  const out: FpVec = {};
  for (const a of AX7) {
    const v = (r as any)[a];
    if (typeof v === "number" && Number.isFinite(v)) out[a] = v;
  }
  return out;
};
const asRated = (r: Row): RatedFp => ({
  id: r.id, name: r.name, producer: r.producer, region: r.region,
  type: r.type as WineType, fp: fpOf(r), stars: r.stars,
});

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
function pearson(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db);
}
function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const out = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k][1]] = r;
    i = j + 1;
  }
  return out;
}
const spearman = (a: number[], b: number[]) => pearson(rank(a), rank(b));

const TYPE: WineType = (process.argv[2] as WineType) ?? "red";
const pool = rated.filter((r) => (r.type as WineType) === TYPE && r.scored);

type Rec = {
  name: string; stars: number; pred: number; err: number; axes: number;
  neighbours: number; M: number; fallback: boolean; nearest: string; nearestStars: number;
  nullPred: number;
};
const rows: Rec[] = [];

for (const held of pool) {
  const restRows = pool.filter((r) => r.id !== held.id);
  const rest = restRows.map(asRated);
  const [rec] = recommend(rest, [{ id: held.id, name: held.name, type: TYPE, fp: fpOf(held) }], { restrictToRatedTypes: false });
  if (!rec) continue;
  const ctx = buildTypeContext(rest, TYPE)!;
  const fp = fpOf(held);
  const neighbours = rest.filter((r) => distanceInContext(fp, r.fp, ctx) <= ctx.h).length;
  rows.push({
    name: `${held.name} ${held.vintage ?? ""}`.trim(),
    stars: held.stars,
    pred: rec.predicted,
    err: rec.predicted - held.stars,
    axes: AX7.filter((a) => (held as any)[a] != null).length,
    neighbours,
    M: rec.evidence,
    fallback: rec.evidence < 1e-9,
    nearest: rec.nearest?.name ?? "—",
    nearestStars: rec.nearest?.stars ?? NaN,
    nullPred: mean(restRows.map((r) => r.stars)),
  });
}

console.log(`=== ${TYPE.toUpperCase()}: per-wine leave-one-out, 7-axis active set (n=${rows.length}) ===`);
console.log("act  pred   err    axes  nbrs      M   fb  wine  →  nearest anchor");
for (const r of [...rows].sort((a, b) => Math.abs(b.err) - Math.abs(a.err))) {
  console.log(
    `${r.stars}    ${r.pred.toFixed(2)}  ${(r.err >= 0 ? "+" : "") + r.err.toFixed(2)}   ` +
    `${String(r.axes).padStart(2)}    ${String(r.neighbours).padStart(2)}  ${r.M.toFixed(3).padStart(6)}  ` +
    `${r.fallback ? "Y" : " "}   ${r.name}  →  ${r.nearest} (${r.nearestStars}★)`,
  );
}

const abs = rows.map((r) => Math.abs(r.err));
const mae = mean(abs);
console.log(`\nMAE ${mae.toFixed(3)}   signed ${mean(rows.map((r) => r.err)).toFixed(3)}   SD(err) ${sd(rows.map((r) => r.err)).toFixed(3)}`);

// Concentration
const sorted = [...abs].sort((a, b) => b - a);
const total = sorted.reduce((a, b) => a + b, 0);
const share = (k: number) => (sorted.slice(0, k).reduce((a, b) => a + b, 0) / total) * 100;
console.log(`\nError concentration: median |err| ${sorted[Math.floor(sorted.length / 2)].toFixed(2)}`);
console.log(`  worst 3 wines carry ${share(3).toFixed(1)}% of total error; worst 5 ${share(5).toFixed(1)}%; worst 8 ${share(8).toFixed(1)}%`);
for (const t of [0.5, 1, 1.5, 2, 3]) {
  console.log(`  |err| ≥ ${t}: ${abs.filter((e) => e >= t).length} of ${abs.length}`);
}

// Correlations
const corr = (label: string, xs: number[]) =>
  console.log(`  |err| vs ${label.padEnd(16)} Pearson ${pearson(xs, abs).toFixed(3)}  Spearman ${spearman(xs, abs).toFixed(3)}`);
console.log(`\nWhat predicts a miss?`);
corr("axes read", rows.map((r) => r.axes));
corr("neighbour count", rows.map((r) => r.neighbours));
corr("evidence mass M", rows.map((r) => r.M));
corr("actual stars", rows.map((r) => r.stars));

// Buckets
console.log(`\nMAE by axes read:`);
for (const [lo, hi] of [[3, 4], [5, 5], [6, 7]] as const) {
  const g = rows.filter((r) => r.axes >= lo && r.axes <= hi);
  if (g.length) console.log(`  ${lo}–${hi} axes: n=${g.length} MAE ${mean(g.map((r) => Math.abs(r.err))).toFixed(3)}`);
}
console.log(`MAE by neighbour count:`);
for (const [lo, hi, lbl] of [[0, 0, "0"], [1, 2, "1–2"], [3, 5, "3–5"], [6, 99, "6+"]] as const) {
  const g = rows.filter((r) => r.neighbours >= lo && r.neighbours <= hi);
  if (g.length) console.log(`  ${lbl} neighbours: n=${g.length} MAE ${mean(g.map((r) => Math.abs(r.err))).toFixed(3)}`);
}
console.log(`MAE by actual rating:`);
for (const s of [1, 2, 3, 4, 5]) {
  const g = rows.filter((r) => r.stars === s);
  if (g.length) console.log(`  ${s}★: n=${g.length} MAE ${mean(g.map((r) => Math.abs(r.err))).toFixed(3)} signed ${mean(g.map((r) => r.err)).toFixed(3)}`);
}

// ── The null model ──
const nullAbs = rows.map((r) => Math.abs(r.nullPred - r.stars));
const nullMae = mean(nullAbs);
const medPool = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const medAbs = rows.map((r, i) => {
  const rest = pool.filter((p) => p.id !== pool[i].id).map((p) => p.stars);
  return Math.abs(medPool(rest) - r.stars);
});
const d = rows.map((r, i) => Math.abs(r.err) - nullAbs[i]);
const se = sd(d) / Math.sqrt(d.length);
console.log(`\n=== NULL MODEL (predict the per-type mean of the remainder) ===`);
console.log(`  null MAE (mean)   ${nullMae.toFixed(3)}`);
console.log(`  null MAE (median) ${mean(medAbs).toFixed(3)}`);
console.log(`  engine MAE        ${mae.toFixed(3)}`);
console.log(`  paired engine − null: ${(mean(d) >= 0 ? "+" : "") + mean(d).toFixed(3)} [95% CI ${(mean(d) - 1.96 * se).toFixed(3)}, ${(mean(d) + 1.96 * se).toFixed(3)}]`);
console.log(`  engine beat null on ${d.filter((x) => x < 0).length} of ${d.length} wines`);
console.log(`  rating spread: SD ${sd(rows.map((r) => r.stars)).toFixed(3)}, mean ${mean(rows.map((r) => r.stars)).toFixed(2)}`);
console.log(`  rank agreement engine vs actual: Spearman ${spearman(rows.map((r) => r.pred), rows.map((r) => r.stars)).toFixed(3)}`);
console.log(`  prediction spread: SD ${sd(rows.map((r) => r.pred)).toFixed(3)}, range ${Math.min(...rows.map((r) => r.pred)).toFixed(2)}–${Math.max(...rows.map((r) => r.pred)).toFixed(2)}`);
const lo = rows.filter((r) => r.stars <= 2), hi = rows.filter((r) => r.stars >= 4);
if (lo.length && hi.length) console.log(`  mean prediction: dislikes (≤2★) ${mean(lo.map((r) => r.pred)).toFixed(2)} vs loves (≥4★) ${mean(hi.map((r) => r.pred)).toFixed(2)} — separation ${(mean(hi.map((r) => r.pred)) - mean(lo.map((r) => r.pred))).toFixed(2)}`);
console.log(`  MAE excluding the 5 catastrophic misses (|err|≥3): ${mean(abs.filter((e) => e < 3)).toFixed(3)} (n=${abs.filter((e) => e < 3).length})`);
