/**
 * Engine snapshot for one user, from live data. Run it before and after working
 * the vintage cards; a diff of two runs is the report.
 *
 * It reads what the app reads — the same recommender, the same code computation,
 * the same anchor weights — so a "nothing changed" claim is a measurement rather
 * than an assertion.
 *
 *   psql -At -c "<the query printed by --sql>" > /tmp/snap/data.json
 *   bunx tsx scripts/palate-snapshot.ts /tmp/snap/data.json > /tmp/snap/before.json
 */
import { readFileSync } from "node:fs";
import {
  recommend,
  __debug_learnOmega,
  __debug_pickBandwidth,
  RAX,
  type RatedFp,
  type BottleFp,
  type FpKey,
} from "../src/lib/recommender";
import { computeCode, axesFor, type RatedBottle, type PaletteType } from "../src/lib/palate";

const AXES = RAX.filter((a) => a !== "fresh") as FpKey[];

type Row = Record<string, any>;
const raw = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/snap/data.json", "utf8"));
const bottles: Row[] = raw.bottles ?? [];
const ratings: Row[] = raw.ratings ?? [];
const canons: Row[] = raw.canons ?? [];
const cands: Row[] = raw.candidates ?? [];

const byId = new Map(bottles.map((b) => [b.id, b]));
const canonIds = new Set(canons.filter((c) => c.tier === "canon").map((c) => c.bottle_id));
const nemIds = new Set(canons.filter((c) => c.tier === "nemesis").map((c) => c.bottle_id));

const fpOf = (b: Row) => {
  const fp: Record<string, number> = {};
  for (const a of AXES) {
    const v = b[`fp_${a}`];
    if (v != null) fp[a] = Number(v);
  }
  return fp;
};

const rated: RatedFp[] = ratings.flatMap((r) => {
  const b = byId.get(r.bottle_id);
  if (!b) return [];
  return [
    {
      id: b.id,
      name: b.name,
      producer: b.producer,
      region: b.region,
      type: b.type === "white" ? "white" : "red",
      fp: fpOf(b) as any,
      stars: r.stars,
      canon: canonIds.has(b.id),
      nemesis: nemIds.has(b.id),
    } as RatedFp,
  ];
});

const unrated: BottleFp[] = cands.map((b) => ({
  id: b.id,
  name: b.name,
  producer: b.producer,
  region: b.region,
  type: b.type === "white" ? "white" : "red",
  fp: fpOf(b) as any,
  fpPipeline: b.fp_pipeline,
}) as BottleFp);

// ── palate codes ──
const toRatedBottles = (t: PaletteType): RatedBottle[] =>
  ratings.flatMap((r) => {
    const b = byId.get(r.bottle_id);
    if (!b) return [];
    const bt = b.type === "white" ? "white" : "red";
    if (bt !== t) return [];
    return [
      {
        stars: r.stars,
        canon: canonIds.has(b.id),
        values: {
          body: b.ax_body,
          fruit_char: b.ax_fruit_char,
          tannin: b.ax_tannin,
          acidity: b.ax_acidity,
          sweet: b.ax_sweet,
        },
      } as RatedBottle,
    ];
  });

const codes = {
  red: computeCode(toRatedBottles("red"), axesFor("red")).code,
  white: computeCode(toRatedBottles("white"), axesFor("white")).code,
};

// ── omega + bandwidth, per type ──
function omegaFor(type: "red" | "white") {
  const set = rated.filter((r) => r.type === type);
  if (!__debug_learnOmega || !__debug_pickBandwidth || set.length === 0) return null;
  const fit = __debug_learnOmega(set as any, type as any);
  const h = __debug_pickBandwidth(set as any, fit as any);
  const out: Record<string, number | null> = {};
  for (const a of AXES) out[a] = (fit as any)?.omega?.[a] ?? null;
  return { omega: out, activeAxes: (fit as any)?.active ?? null, h: Number(h.toFixed(4)), n: set.length };
}

// ── anchors in style space ──
const anchors = rated
  .filter((r) => r.canon || r.nemesis)
  .map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    role: r.canon ? "benchmark" : "dealbreaker",
    stars: r.stars,
    position: Object.fromEntries(AXES.map((a) => [a, (r.fp as any)[a] ?? null])),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

// ── top five per type, from the real recommender ──
const recs = recommend(rated, unrated);
if (process.env["SNAP_DEBUG"]) console.error("recs", recs.length, "vetoed", recs.filter((r) => r.vetoed).length, JSON.stringify(recs[0] ?? null));
const candType = new Map(cands.map((c) => [c.id, c.type === "white" ? "white" : "red"]));
const topN = (type: "red" | "white", n = 5) =>
  recs
    .filter((r) => r.bottle.type === type && !r.vetoed)
    .slice(0, n)
    .map((r, idx) => ({
      rank: idx + 1,
      id: r.bottle.id,
      name: r.bottle.name,
      predicted: Number(r.predicted.toFixed(4)),
      maxSimilarity: r.maxSimilarity == null ? null : Number(r.maxSimilarity.toFixed(4)),
      contested: !!r.contestedReason,
    }));

console.log(
  JSON.stringify(
    {
      at: new Date().toISOString(),
      counts: { rated: rated.length, candidates: unrated.length, anchors: anchors.length },
      codes,
      omega: { red: omegaFor("red"), white: omegaFor("white") },
      anchors,
      top: { red: topN("red"), white: topN("white") },
    },
    null,
    2,
  ),
);
