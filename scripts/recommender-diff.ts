/**
 * Real recommender diff: whites, user e3c4104c…, before vs after the
 * fp_savory benchmark corrections.
 *
 * BEFORE snapshot (from catalog_corrections):
 *   Chateau Montelena 2014 Chardonnay: fp_savory 0.30 (now 0.65)
 *   Gaja Rossj-Bass:                    fp_savory 0.40 (now 0.55)
 * All other axes on those two bottles are unchanged.
 */
import { readFileSync } from "node:fs";
import { recommend, __debug_learnOmega, __debug_pickBandwidth,
  type RatedFp, type BottleFp, CANON_WEIGHT, RAX } from "../src/lib/recommender";

const RATED: Array<{ id: string; name: string; stars: number; canon: boolean; fp: Record<string, number> }> = [
  { id: "7774a975-b01f-495c-a2e9-1d3d01e8b63a", name: "Ingrid Groiss 2016 Grüner Veltliner", stars: 5, canon: false,
    fp: { fresh:0.85, acid:0.75, tannin:0, fruit_dark:0, ripe:0.35, oak:0.05, body:0.4, savory:0.6 } },
  { id: "295cd499-d82f-4180-a130-3fd59ad6defc", name: "Chateau Montelena 2014 Chardonnay", stars: 5, canon: true,
    fp: { fresh:0.8, acid:0.85, tannin:0, fruit_dark:0, ripe:0.35, oak:0.25, body:0.55, savory:0.65 } },
  { id: "5b6eb5d9-fb46-48c4-a96a-7fd2540a7d80", name: "Gaja Rossj-Bass", stars: 5, canon: true,
    fp: { fresh:0.85, acid:0.8, tannin:0, fruit_dark:0, ripe:0.3, oak:0.1, body:0.5, savory:0.55 } },
  { id: "b33fb735-a060-46b0-baa0-65ba740d6b6c", name: "La Caña 2016 Albariño", stars: 5, canon: false,
    fp: { fresh:0.8, acid:0.75, tannin:0, fruit_dark:0, ripe:0.35, oak:0.05, body:0.4, savory:0.2 } },
  { id: "93861086-173c-479e-862b-2ed87b4f12db", name: "Château de Montfort 2011 Demi-sec Vouvray", stars: 5, canon: false,
    fp: { fresh:0.8, acid:0.85, tannin:0, fruit_dark:0, ripe:0.6, oak:0.1, body:0.45, savory:0.35 } },
  { id: "a2a4e1aa-2a1f-49bd-b944-ffd663bb7ffe", name: "Meursault Bourgogne", stars: 4, canon: false,
    fp: { fresh:0.65, acid:0.6, tannin:0, fruit_dark:0, ripe:0.55, oak:0.5, body:0.6, savory:0.4 } },
  { id: "bd109a31-5da4-4b5a-9e65-0dfbfd9edc69", name: "La Caña 2014 Albariño", stars: 4, canon: false,
    fp: { fresh:0.85, acid:0.75, tannin:0, fruit_dark:0, ripe:0.5, oak:0.05, body:0.45, savory:0.3 } },
  { id: "cd2dbe00-d5c3-4468-b522-b915be7950d6", name: "Château de Montfort 2015 Demi-Sec Vouvray", stars: 4, canon: false,
    fp: { fresh:0.8, acid:0.85, tannin:0, fruit_dark:0, ripe:0.6, oak:0.1, body:0.45, savory:0.35 } },
  { id: "fdbd7670-cb1e-4a90-87ae-a8f83a760076", name: "IDDA", stars: 3, canon: false,
    fp: { fresh:0.85, acid:0.8, tannin:0, fruit_dark:0, ripe:0.5, oak:0.1, body:0.45, savory:0.6 } },
];

function buildRated(overrides: Record<string, Partial<Record<string, number>>> = {}): RatedFp[] {
  return RATED.map((r) => {
    const fp = { ...r.fp, ...(overrides[r.id] ?? {}) };
    return {
      id: r.id, name: r.name, type: "white" as const, fp: fp as any,
      stars: r.stars, canon: r.canon,
      weight: r.canon ? CANON_WEIGHT : 1,
    };
  });
}

const csv = readFileSync("/tmp/whites.csv", "utf8").trim().split("\n");
const header = csv[0].split(",");
const idx = (k: string) => header.indexOf(k);
const ratedIds = new Set(RATED.map((r) => r.id));
const allWhites: BottleFp[] = csv.slice(1).map((line) => {
  // naive csv split — none of the fields contain commas or quotes in this export except the name; use a safer split
  const parts: string[] = [];
  let cur = ""; let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) { parts.push(cur); cur = ""; }
    else cur += ch;
  }
  parts.push(cur);
  return {
    id: parts[idx("id")], name: parts[idx("name")],
    producer: parts[idx("producer")] || null, region: parts[idx("region")] || null,
    type: "white" as const,
    fp: {
      fresh: +parts[idx("fp_fresh")], acid: +parts[idx("fp_acid")],
      tannin: +parts[idx("fp_tannin")], fruit_dark: +parts[idx("fp_fruit_dark")],
      ripe: +parts[idx("fp_ripe")], oak: +parts[idx("fp_oak")],
      body: +parts[idx("fp_body")], savory: +parts[idx("fp_savory")],
    },
  };
});
const unrated = allWhites.filter((b) => !ratedIds.has(b.id));
console.log(`# whites in catalog: ${allWhites.length}, unrated for user: ${unrated.length}`);

// BEFORE overrides: revert fp_savory on the two benchmarks. All other axes
// were untouched during the corrections; nothing else changes.
const beforeOverrides = {
  "295cd499-d82f-4180-a130-3fd59ad6defc": { savory: 0.30 },
  "5b6eb5d9-fb46-48c4-a96a-7fd2540a7d80": { savory: 0.40 },
};

function runPass(label: string, overrides: any) {
  const rated = buildRated(overrides);
  const omega = __debug_learnOmega!(rated, "white");
  const h = __debug_pickBandwidth!(rated, omega);
  const recs = recommend(rated, unrated);
  console.log(`\n===== ${label} =====`);
  console.log(`omega:  ${RAX.map((k) => `${k}=${omega.omega[k].toFixed(3)}`).join("  ")}`);
  console.log(`h (bandwidth): ${h.toFixed(4)}`);
  const benchmarks = rated.filter((r) => r.canon);
  for (const b of benchmarks) {
    console.log(`benchmark ${b.name.padEnd(38)} fp_savory=${b.fp.savory.toFixed(2)}  fp=[${RAX.map((k)=>b.fp[k].toFixed(2)).join(",")}]`);
  }
  console.log(`top 5:`);
  for (const r of recs.slice(0, 5)) {
    console.log(`  ${r.predicted.toFixed(3)}  ${r.bottle.name.slice(0, 60).padEnd(60)}  savory=${r.bottle.fp.savory.toFixed(2)}  nearest=${r.nearest?.name.slice(0,30) ?? "-"}`);
  }
  return { omega, h, top: recs.slice(0, 5) };
}

const before = runPass("BEFORE (fp_savory: Montelena=0.30, Rossj-Bass=0.40)", beforeOverrides);
const after  = runPass("AFTER  (fp_savory: Montelena=0.65, Rossj-Bass=0.55)", {});

console.log(`\n===== DELTA =====`);
console.log(`omega delta (savory): ${(after.omega.omega.savory - before.omega.omega.savory).toFixed(4)}`);
const beforeIds = new Set(before.top.map((r) => r.bottle.id));
const afterIds = new Set(after.top.map((r) => r.bottle.id));
const churned = after.top.filter((r) => !beforeIds.has(r.bottle.id));
console.log(`top-5 churn: ${churned.length}/5 new entries`);
for (const r of churned) console.log(`  NEW: ${r.bottle.name.slice(0,60)}`);
const dropped = before.top.filter((r) => !afterIds.has(r.bottle.id));
for (const r of dropped) console.log(`  DROPPED: ${r.bottle.name.slice(0,60)}`);
