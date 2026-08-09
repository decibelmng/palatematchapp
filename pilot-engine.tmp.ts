import { readFileSync } from "node:fs";
import { predictStarsMany } from "./src/lib/predict-core";
const rated = JSON.parse(readFileSync("/tmp/rated.json", "utf8"));
const pilot = JSON.parse(readFileSync("/tmp/pilot-v3.json", "utf8"));
const AX = ["fresh","acid","tannin","fruit_dark","ripe","oak","body","savory"];
const mk = (r: any, src: "prior" | "v3") => ({
  id: r.id, type: "red", name: r.name, producer: r.producer, vintage: null, region: r.region,
  ...Object.fromEntries(AX.map((a) => ["fp_" + a, r[src][a]])),
  fp_scored_at: "2026-08-09T00:00:00Z",
});
for (const src of ["prior", "v3"] as const) {
  const res = predictStarsMany(rated, pilot.map((r: any) => mk(r, src)));
  const out = pilot.map((r: any) => ({ name: r.name, ...res.get(r.id)! }));
  const ok = out.filter((o) => o.predicted !== null);
  const preds = ok.map((o) => o.predicted as number).sort((a, b) => a - b);
  const mean = preds.reduce((s, p) => s + p, 0) / preds.length;
  const sd = Math.sqrt(preds.reduce((s, p) => s + (p - mean) ** 2, 0) / preds.length);
  console.log(`\n===== ${src.toUpperCase()} (${src === "prior" ? "v1 typicity grid" : "v3 de-anchored notes"}) =====`);
  console.log(`  scored ${ok.length}/40   null ${40 - ok.length}`);
  console.log(`  predicted: min ${preds[0].toFixed(2)}  max ${preds[preds.length-1].toFixed(2)}  spread ${(preds[preds.length-1]-preds[0]).toFixed(3)}  sd ${sd.toFixed(3)}`);
  const sup = ok.map((o) => o.neighborSupport ?? 0);
  console.log(`  support: zero-support wines ${sup.filter((s) => s === 0).length}   median ${sup.sort((a,b)=>a-b)[sup.length>>1]}`);
  const reasons: Record<string, number> = {};
  for (const o of out) if (o.nullReason) reasons[o.nullReason] = (reasons[o.nullReason] ?? 0) + 1;
  if (Object.keys(reasons).length) console.log("  null reasons:", reasons);
  const rank = [...ok].sort((a, b) => (b.predicted as number) - (a.predicted as number));
  console.log("  top 3:   ", rank.slice(0, 3).map((o) => `${o.name.slice(0, 42)} ${(o.predicted as number).toFixed(2)}`).join(" | "));
  console.log("  bottom 3:", rank.slice(-3).map((o) => `${o.name.slice(0, 42)} ${(o.predicted as number).toFixed(2)}`).join(" | "));
}
