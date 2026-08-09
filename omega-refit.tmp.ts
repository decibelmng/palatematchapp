import { readFileSync } from "node:fs";
import { predictStars } from "./src/lib/predict-core";
const rows = JSON.parse(readFileSync("/tmp/rated.json", "utf8"));
const target = JSON.parse(readFileSync("/tmp/target.json", "utf8"));
for (const t of ["red", "white"] as const) {
  const rated = rows.filter((r: any) => (r.type ?? "red") === t);
  const tgt = target.find((b: any) => (b.type ?? "red") === t) ?? rated[0];
  const res = predictStars(rated, tgt);
  console.log("nullReason:", res.nullReason); console.log(`\n=== ${t}  n=${rated.length}  h=${res.bandwidth?.toFixed(3)}  support=${res.neighborSupport}`);
  const om = res.omega ?? {};
  for (const [k, v] of Object.entries(om).sort((a: any, b: any) => b[1] - a[1]))
    console.log(`  ${k.padEnd(11)} ${(v as number).toFixed(3)}`);
}
