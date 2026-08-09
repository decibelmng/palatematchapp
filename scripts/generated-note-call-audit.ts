/**
 * Would barring GENERATED-NOTE readings from the Call change the Call?
 *
 * Counterfactual only — no engine change. For every list scan of one user we
 * score the lines with the live recommender, pick the Call the way the verdict
 * screen does today, then pick it again with estimated lines excluded from the
 * shortlist (falling back to the best estimate when the list holds no catalog
 * match at all). The report is how often those two differ.
 *
 *   bunx tsx scripts/estimated-call-audit.ts /tmp/aud/data.json
 */
import { readFileSync } from "node:fs";
import {
  recommend,
  isThinRead,
  isAmbiguousJoinRead,
  RAX,
  type RatedFp,
  type BottleFp,
  type FpKey,
} from "../src/lib/recommender";

const AXES = RAX.filter((a) => a !== "fresh") as FpKey[];
type Row = Record<string, any>;

const raw = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/aud/data.json", "utf8"));
const bottles: Row[] = raw.bottles ?? [];
const ratings: Row[] = raw.ratings ?? [];
const canons: Row[] = raw.canons ?? [];
const lines: Row[] = raw.lines ?? [];

const byId = new Map(bottles.map((b) => [b.id, b]));
const canonIds = new Set(canons.filter((c) => c.tier === "canon").map((c) => c.bottle_id));
const nemIds = new Set(canons.filter((c) => c.tier === "nemesis").map((c) => c.bottle_id));

const fpOfBottle = (b: Row) => {
  const fp: Record<string, number> = {};
  for (const a of AXES) {
    const v = b[`fp_${a}`];
    if (v != null) fp[a] = Number(v);
  }
  return fp;
};
const fpOfJson = (j: any) => {
  const fp: Record<string, number> = {};
  if (!j) return fp;
  for (const a of AXES) {
    const v = j[a] ?? j[`fp_${a}`];
    if (v != null) fp[a] = Number(v);
  }
  return fp;
};

const rated: RatedFp[] = ratings.flatMap((r) => {
  const b = byId.get(r.bottle_id);
  if (!b) return [];
  return [{
    id: b.id, name: b.name, producer: b.producer, region: b.region,
    type: b.type === "white" ? "white" : "red",
    fp: fpOfBottle(b) as any,
    stars: r.stars, canon: canonIds.has(b.id), nemesis: nemIds.has(b.id),
  } as RatedFp];
});

// group lines by scan
const scans = new Map<string, Row[]>();
for (const l of lines) {
  if (!scans.has(l.scan_id)) scans.set(l.scan_id, []);
  scans.get(l.scan_id)!.push(l);
}

let listScans = 0, changed = 0, noCatalog = 0, sameBottle = 0, genOnlyLists = 0;
const details: string[] = [];

for (const [scanId, ls] of scans) {
  if (ls.length < 2) continue; // list scans only
  const cands: BottleFp[] = [];
  const meta = new Map<string, Row>();
  for (const l of ls) {
    const t = l.type === "white" ? "white" : l.type === "red" ? "red" : null;
    if (!t) continue;
    const b = l.b_fp;
    const isCatalog = !!b; // variant B: any line resolved to a catalog bottle counts as a real reading
    const fp = b ? fpOfBottle(b) : fpOfJson(l.fp);
    if (Object.keys(fp).length === 0) continue;
    const key = l.id as string;
    cands.push({
      id: key, name: (b?.name ?? l.name ?? "line") as string,
      producer: b?.producer ?? null, region: b?.region ?? null,
      type: t as any, fp: fp as any, fpPipeline: b?.fp_pipeline ?? "estimated",
    } as BottleFp);
    meta.set(key, { ...l, isCatalog, type: t, gen: !!b?.noteless });
  }
  if (cands.length < 2) continue;
  listScans++;

  const ranked = recommend(rated, cands).filter((r) => !r.vetoed);
  if (ranked.length === 0) continue;

  const solid = (rows: typeof ranked) => {
    const s = rows.filter(
      (r) => !isThinRead(r.bottle.fp, r.bottle.type) && !isAmbiguousJoinRead(r.bottle),
    );
    return s.length > 0 ? s : rows;
  };
  const TIE = 0.1;
  const pick = (rows: typeof ranked) => {
    if (rows.length === 0) return null;
    const best = Math.max(...rows.map((r) => r.predicted));
    const tied = rows.filter((r) => best - r.predicted <= TIE).sort((a, b) => {
      const ca = meta.get(a.bottle.id)!.isCatalog, cb = meta.get(b.bottle.id)!.isCatalog;
      if (ca !== cb) return ca ? -1 : 1;
      const ds = (b.maxSimilarity ?? 0) - (a.maxSimilarity ?? 0);
      if (Math.abs(ds) > 0.01) return ds;
      const pa = meta.get(a.bottle.id)!.price, pb = meta.get(b.bottle.id)!.price;
      if (pa && pb && pa !== pb) return Number(pa) - Number(pb);
      return 0;
    });
    return tied[0] ?? null;
  };

  // Today: estimated lines already barred (shipped), thin + ambiguous barred.
  const catalogOnly = solid(ranked).filter((r) => meta.get(r.bottle.id)!.isCatalog);
  if (catalogOnly.length === 0) noCatalog++;
  const todayPool = catalogOnly.length > 0 ? catalogOnly : solid(ranked);
  const now = pick(todayPool);
  // Counterfactual: also bar readings taken from a note no human wrote. Pre-swap
  // no row carries the v3 stamp yet, so the tier is identified by the fact that
  // decides it — no recovered review for that bottle.
  const genFree = todayPool.filter((r) => !meta.get(r.bottle.id)!.gen);
  if (genFree.length === 0) genOnlyLists++;
  const next = pick(genFree.length > 0 ? genFree : todayPool);
  if (!now || !next) continue;
  if (now.bottle.id === next.bottle.id) { sameBottle++; continue; }
  changed++;
  details.push(
    `${scanId.slice(0, 8)}  now: ${now.bottle.name} (generated-note, ${now.predicted.toFixed(2)})  ->  ${next.bottle.name} (${next.predicted.toFixed(2)})  Δ${(now.predicted - next.predicted).toFixed(2)}`,
  );
}

console.log(JSON.stringify({ listScans, unchanged: sameBottle, changed, scansWithNoCatalogMatch: noCatalog, listsEntirelyGeneratedTier: genOnlyLists }, null, 2));
for (const d of details) console.log(d);
