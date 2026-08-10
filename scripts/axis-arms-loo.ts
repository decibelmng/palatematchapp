/**
 * Four-versus-seven axis experiment. MEASUREMENT ONLY — changes no engine code.
 *
 * An "arm" is expressed by MASKING axes out of the reading before it enters the
 * recommender. That is exactly equivalent to shrinking the axis set: a masked
 * axis is absent, and the engine already excludes absent axes from ω, from the
 * distance, and from the rescaling denominator.
 *
 * Run: bun scripts/axis-arms-loo.ts
 */
import {
  recommend,
  buildTypeContext,
  type FpKey,
  type FpVec,
  type RatedFp,
  type BottleFp,
  type WineType,
} from "../src/lib/recommender";

type Row = {
  id: string; name: string; producer: string | null; region: string | null;
  vintage: number | null; type: string; stars?: number; price?: string | null;
  scored: boolean;
} & { [K in "acid" | "tannin" | "fruit_dark" | "ripe" | "oak" | "body" | "savory"]: number | null };

const ARMS: Record<string, FpKey[]> = {
  "A_7axis": ["acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"],
  "B_4axis": ["savory", "fruit_dark", "tannin", "ripe"],
  "C_5axis": ["savory", "fruit_dark", "tannin", "ripe", "body"],
  "D_6axis": ["savory", "fruit_dark", "tannin", "ripe", "acid", "oak"],
};

function fpOf(r: Row, axes: FpKey[]): FpVec {
  const out: FpVec = {};
  for (const a of axes) {
    const v = (r as any)[a];
    if (typeof v === "number" && Number.isFinite(v)) out[a] = v;
  }
  return out;
}
const typeOf = (r: Row) => r.type as WineType;

const rated: Row[] = require("/tmp/axis-exp/rated.json");
const scan: Row[] = require("/tmp/axis-exp/scan.json");

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

// ── per-type null rates on the v3 shadow columns, rated set ──
const AX7 = ARMS["A_7axis"];
console.log("=== RATED SET: v3 coverage ===");
for (const t of ["red", "white"] as WineType[]) {
  const rows = rated.filter((r) => typeOf(r) === t);
  const s = rows.filter((r) => r.scored);
  console.log(`\n${t}: ${rows.length} rated, ${s.length} with a v3 reading`);
  for (const a of AX7) {
    const nulls = s.filter((r) => (r as any)[a] == null).length;
    console.log(`  ${a.padEnd(11)} null ${((nulls / s.length) * 100).toFixed(1)}%  (${nulls}/${s.length})`);
  }
  console.log(`  mean axes read: ${mean(s.map((r) => AX7.filter((a) => (r as any)[a] != null).length)).toFixed(2)}`);
}

// ── Section 1: leave-one-out ──
type ArmResult = {
  n: number; mae: number; mse: number; bias: number; sdErr: number;
  ci: [number, number]; fallback: number; omega: Record<string, number>; h: number;
};

function loo(type: WineType, axes: FpKey[]): ArmResult | null {
  const pool = rated.filter((r) => typeOf(r) === type && r.scored);
  const asRated = (r: Row): RatedFp => ({
    id: r.id, name: r.name, producer: r.producer, region: r.region,
    type: typeOf(r), fp: fpOf(r, axes), stars: r.stars!,
  });
  const errs: number[] = [];
  let fallback = 0;
  for (const held of pool) {
    const rest = pool.filter((r) => r.id !== held.id).map(asRated);
    if (rest.length < 3) continue;
    const cand: BottleFp = {
      id: held.id, name: held.name, producer: held.producer, region: held.region,
      type: typeOf(held), fp: fpOf(held, axes),
    };
    const [rec] = recommend(rest, [cand], { restrictToRatedTypes: false });
    if (!rec) continue;
    if (rec.evidence < 1e-9) fallback++;
    errs.push(rec.predicted - held.stars!);
  }
  if (errs.length === 0) return null;
  const abs = errs.map(Math.abs);
  const m = mean(abs);
  const se = sd(abs) / Math.sqrt(abs.length);
  const ctx = buildTypeContext(pool.map(asRated), type);
  const omega: Record<string, number> = {};
  if (ctx) for (const a of axes) omega[a] = Number(ctx.fit.omega[a].toFixed(2));
  return {
    n: errs.length, mae: m, mse: mean(errs.map((e) => e * e)), bias: mean(errs),
    sdErr: sd(errs), ci: [m - 1.96 * se, m + 1.96 * se], fallback, omega,
    h: ctx ? Number(ctx.h.toFixed(3)) : NaN,
  };
}

console.log("\n\n=== SECTION 1: leave-one-out, per type ===");
for (const t of ["red", "white"] as WineType[]) {
  console.log(`\n--- ${t.toUpperCase()} ---`);
  for (const [name, axes] of Object.entries(ARMS)) {
    const r = loo(t, axes);
    if (!r) { console.log(`${name}: not enough data`); continue; }
    console.log(
      `${name.padEnd(9)} n=${r.n} MAE ${r.mae.toFixed(3)} ` +
      `[95% CI ${r.ci[0].toFixed(3)}–${r.ci[1].toFixed(3)}] ` +
      `signed ${r.bias >= 0 ? "+" : ""}${r.bias.toFixed(3)} SD(err) ${r.sdErr.toFixed(3)} ` +
      `RMSE ${Math.sqrt(r.mse).toFixed(3)} shrinkage-fallback ${r.fallback} h=${r.h}`,
    );
    console.log(`          ω ${JSON.stringify(r.omega)}`);
  }
}

// ── Section 3: rank agreement on the real list ──
function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
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
  };
  const ra = rank(a), rb = rank(b);
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

console.log("\n\n=== SECTION 3: the 40-wine list (scan 4fd26c64) ===");
const scored = scan.filter((r) => r.scored);
console.log(`${scan.length} wines matched to catalog rows; ${scored.length} carry a v3 reading`);

const perArmScores: Record<string, Map<string, number>> = {};
for (const [name, axes] of Object.entries(ARMS)) {
  const preds = new Map<string, number>();
  for (const t of ["red", "white"] as WineType[]) {
    const pool = rated.filter((r) => typeOf(r) === t && r.scored).map((r): RatedFp => ({
      id: r.id, name: r.name, producer: r.producer, region: r.region,
      type: t, fp: fpOf(r, axes), stars: r.stars!,
    }));
    const cands = scored.filter((r) => typeOf(r) === t).map((r): BottleFp => ({
      id: r.id, name: r.name, producer: r.producer, region: r.region,
      type: t, fp: fpOf(r, axes),
    }));
    if (pool.length < 3 || cands.length === 0) continue;
    for (const rec of recommend(pool, cands, { restrictToRatedTypes: false })) {
      preds.set(rec.bottle.id, rec.predicted);
    }
  }
  perArmScores[name] = preds;
}

const names = Object.keys(ARMS);
for (const t of ["red", "white", "all"] as const) {
  const ids = [...perArmScores["A_7axis"].keys()].filter((id) => {
    const row = scored.find((r) => r.id === id)!;
    return t === "all" || typeOf(row) === t;
  });
  if (ids.length < 3) continue;
  console.log(`\nSpearman between arms (${t}, n=${ids.length}):`);
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      const a = ids.map((id) => perArmScores[names[i]].get(id) ?? 0);
      const b = ids.map((id) => perArmScores[names[j]].get(id) ?? 0);
      console.log(`  ${names[i]} vs ${names[j]}: ρ ${spearman(a, b).toFixed(3)}`);
    }
}

for (const name of names) {
  console.log(`\nTop five — ${name}:`);
  [...perArmScores[name].entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).forEach(([id, p], i) => {
    const row = scored.find((r) => r.id === id)!;
    console.log(`  ${i + 1}. ${p.toFixed(2)}  ${row.name} ${row.vintage ?? ""} [${row.type}] ${row.price ?? ""}`);
  });
}

console.log("\nNamed-pair check (Insignia vs Lodi/cheap Cabernet):");
const marks = scan.filter((r) => /insignia|lodi/i.test(`${r.name} ${r.producer ?? ""} ${r.region ?? ""}`));
if (marks.length === 0) console.log("  neither wine is present in the matched rows of this scan");
for (const m of marks) {
  const line = names.map((n) => `${n}=${perArmScores[n].get(m.id)?.toFixed(2) ?? "—"}`).join("  ");
  console.log(`  ${m.name} ${m.vintage ?? ""} (${m.region ?? "?"}) v3=${m.scored} ${line}`);
}

console.log("\nAll scored reds on the list, by arm (predicted):");
for (const r of scored.filter((x) => x.type === "red").sort((a, b) => (perArmScores["B_4axis"].get(b.id) ?? 0) - (perArmScores["B_4axis"].get(a.id) ?? 0))) {
  console.log(
    `  ${names.map((n) => (perArmScores[n].get(r.id) ?? NaN).toFixed(2)).join("  ")}  ` +
    `axes=${AX7.filter((a) => (r as any)[a] != null).length}  ${r.name} ${r.vintage ?? ""} ${r.price ?? ""}`,
  );
}
console.log("\nUnscored (no v3 reading) reds on the list:");
for (const r of scan.filter((x) => x.type === "red" && !x.scored)) console.log(`  ${r.name} ${r.vintage ?? ""} ${r.price ?? ""}`);

// Paired comparison over the identical held-out wines (same fits, no re-run).
function looErrs(type: WineType, axes: FpKey[]): Map<string, number> {
  const pool = rated.filter((r) => typeOf(r) === type && r.scored);
  const out = new Map<string, number>();
  for (const held of pool) {
    const rest = pool.filter((r) => r.id !== held.id).map((r): RatedFp => ({
      id: r.id, name: r.name, producer: r.producer, region: r.region, type: typeOf(r), fp: fpOf(r, axes), stars: r.stars!,
    }));
    if (rest.length < 3) continue;
    const [rec] = recommend(rest, [{ id: held.id, name: held.name, type: typeOf(held), fp: fpOf(held, axes) }], { restrictToRatedTypes: false });
    if (rec) out.set(held.id, Math.abs(rec.predicted - held.stars!));
  }
  return out;
}
console.log("\n=== Paired |error| differences vs the 7-axis arm (reds) ===");
const base = looErrs("red", ARMS["A_7axis"]);
for (const n of ["B_4axis", "C_5axis", "D_6axis"]) {
  const o = looErrs("red", ARMS[n]);
  const d = [...base.keys()].map((id) => (o.get(id) ?? NaN) - base.get(id)!).filter(Number.isFinite);
  const m = mean(d), se = sd(d) / Math.sqrt(d.length);
  console.log(`  ${n} − A: ${m >= 0 ? "+" : ""}${m.toFixed(3)} [95% CI ${(m - 1.96 * se).toFixed(3)}, ${(m + 1.96 * se).toFixed(3)}] n=${d.length}`);
}
