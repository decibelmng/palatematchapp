/** Cluster census for scan 4fd26c64 — quantifies the "N wines within 0.1 of
 *  the Call" observation. Read-only, no DB writes, no UI. Data is a frozen
 *  snapshot pulled from the live tables (ratings + matched scan_wines) so the
 *  numbers are reproducible.
 *
 *  Run: bunx tsx scripts/cluster-census.ts   (or bun run scripts/cluster-census.ts)
 */
import { predictStarsMany, type FpRow } from "../src/lib/predict-core";

type R = [string, string, number, number, number, number, number, number, number, number, number, number | null];
type C = [string, number, number, number, number, number, number, number, number, string, string, string, string, number | null];

const RATED_RED: R[] = [
  ["d5a147bb", "red", 0.35, 0.55, 0.7, 0.9, 0.8, 0.85, 0.85, 0.3, 5, 2005],
  ["766ad257", "red", 0.35, 0.55, 0.7, 0.9, 0.8, 0.85, 0.85, 0.3, 5, 2006],
  ["6c158623", "red", 0.35, 0.55, 0.65, 0.9, 0.8, 0.8, 0.85, 0.4, 5, 2007],
  ["1e33d57a", "red", 0.35, 0.55, 0.65, 0.9, 0.8, 0.8, 0.85, 0.4, 5, 2008],
  ["c6ab2b38", "red", 0.65, 0.7, 0.35, 0.15, 0.6, 0.45, 0.5, 0.45, 4, 2006],
  ["8e4ce92a", "red", 0.55, 0.6, 0.65, 0.8, 0.7, 0.6, 0.75, 0.4, 4, null],
  ["8e08903f", "red", 0.55, 0.6, 0.6, 0.75, 0.65, 0.6, 0.7, 0.5, 5, 2000],
  ["d56238bf", "red", 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 5, null],
  ["3a6cfa87", "red", 0.55, 0.6, 0.6, 0.75, 0.65, 0.6, 0.7, 0.5, 5, 2010],
  ["5768d617", "red", 0.55, 0.6, 0.6, 0.75, 0.65, 0.6, 0.7, 0.5, 5, 2009],
  ["254d75bc", "red", 0.35, 0.55, 0.8, 0.9, 0.85, 0.8, 0.9, 0.35, 5, 2003],
  ["8e62eff4", "red", 0.5, 0.6, 0.65, 0.8, 0.6, 0.55, 0.7, 0.55, 4, 2012],
  ["b64f518a", "red", 0.55, 0.5, 0.75, 0.75, 0.65, 0.45, 0.7, 0.7, 4, 2008],
  ["286aa1a9", "red", 0.7, 0.75, 0, 0, 0.6, 0.1, 0.5, 0.65, 4, null],
  ["f521c62c", "red", 0.65, 0.7, 0.65, 0.55, 0.6, 0.6, 0.7, 0.65, 2, 2007],
  ["d7ca5cf6", "red", 0.65, 0.85, 0.85, 0.35, 0.55, 0.6, 0.8, 0.75, 1, 2007],
  ["a2ac4a09", "red", 0.7, 0.75, 0.45, 0.1, 0.4, 0.05, 0.45, 0.7, 3, 2012],
  ["b52cdfbb", "red", 0.5, 0.5, 0.75, 0.8, 0.7, 0.6, 0.8, 0.7, 5, 2009],
  ["26d02e57", "red", 0.7, 0.75, 0.45, 0.1, 0.35, 0.1, 0.45, 0.65, 4, 2024],
  ["4c319888", "red", 0.8, 0.75, 0.35, 0.2, 0.55, 0.3, 0.45, 0.45, 3, 2022],
  ["afd49317", "red", 0.45, 0.55, 0.65, 0.85, 0.75, 0.7, 0.75, 0.45, 5, 2007],
  ["575bee74", "red", 0.35, 0.45, 0.5, 0.75, 0.85, 0.6, 0.75, 0.25, 1, 2007],
  ["c60a861f", "red", 0.35, 0.45, 0.55, 0.9, 0.85, 0.6, 0.8, 0.2, 1, 2009],
  ["ec56bfe3", "red", 0.35, 0.45, 0.55, 0.9, 0.8, 0.6, 0.75, 0.2, 1, 2010],
  ["569fe928", "red", 0.35, 0.55, 0.65, 0.9, 0.8, 0.8, 0.85, 0.4, 5, 2006],
  ["f125d07a", "red", 0.45, 0.55, 0.7, 0.9, 0.85, 0.75, 0.85, 0.45, 5, 2013],
  ["d0ea10ac", "red", 0.55, 0.8, 0.65, 0.3, 0.6, 0.6, 0.75, 0.65, 5, 2010],
  ["0781bd97", "red", 0.55, 0.8, 0.65, 0.3, 0.6, 0.6, 0.75, 0.65, 5, 2012],
  ["50fdb1f5", "red", 0.25, 0.45, 0.65, 0.9, 0.9, 0.7, 0.85, 0.3, 1, 2013],
  ["b319b95d", "red", 0.55, 0.5, 0.75, 0.8, 0.7, 0.6, 0.8, 0.55, 5, 2022],
  ["43321401", "red", 0.65, 0.6, 0.75, 0.8, 0.6, 0.55, 0.75, 0.65, 4, 2020],
  ["6d985a93", "red", 0.7, 0.75, 0.3, 0.1, 0.45, 0.05, 0.45, 0.58, 4, 1999],
  ["6f72ac21", "red", 0.6, 0.7, 0.65, 0.15, 0.35, 0.2, 0.55, 0.75, 5, 1997],
  ["9b76d5a8", "red", 0.65, 0.65, 0.78, 0.8, 0.65, 0.45, 0.75, 0.7, 5, 2006],
  ["bc6b43a0", "red", 0.65, 0.8, 0.8, 0.8, 0.7, 0.75, 0.9, 0.65, 5, 2007],
  ["02a05fe0", "red", 0.65, 0.8, 0.8, 0.8, 0.7, 0.75, 0.9, 0.65, 5, 2008],
  ["019fa4c3", "red", 0.55, 0.55, 0.7, 0.8, 0.7, 0.55, 0.75, 0.7, 5, 2011],
  ["ddc71495", "red", 0.7, 0.75, 0.35, 0.15, 0.55, 0.45, 0.5, 0.65, 5, 2009],
];

const RATED_WHITE: R[] = [
  ["fdbd7670", "white", 0.85, 0.8, 0, 0, 0.5, 0.1, 0.45, 0.6, 3, 2022],
  ["295cd499", "white", 0.8, 0.85, 0, 0, 0.35, 0.25, 0.55, 0.65, 5, 2014],
  ["a2a4e1aa", "white", 0.65, 0.6, 0, 0, 0.55, 0.5, 0.6, 0.4, 4, 2022],
  ["5b6eb5d9", "white", 0.85, 0.8, 0, 0, 0.3, 0.1, 0.5, 0.55, 5, null],
  ["06d40ef8", "white", 0.78, 0.77, 0, 0, 0.3, 0.08, 0.42, 0.7, 5, 2024],
  ["6f876396", "dessert", 0.3, 0.65, 0, 0, 0.85, 0.2, 0.8, 0.6, 5, null],
  ["b33fb735", "white", 0.8, 0.75, 0, 0, 0.35, 0.05, 0.4, 0.2, 5, 2016],
  ["93861086", "white", 0.8, 0.85, 0, 0, 0.6, 0.1, 0.45, 0.35, 5, 2011],
  ["bd109a31", "white", 0.85, 0.75, 0, 0, 0.5, 0.05, 0.45, 0.3, 4, 2014],
  ["cd2dbe00", "white", 0.8, 0.85, 0, 0, 0.6, 0.1, 0.45, 0.35, 4, 2015],
  ["7774a975", "white", 0.85, 0.75, 0, 0, 0.35, 0.05, 0.4, 0.6, 5, 2016],
  ["4d5cd943", "white", 0.78, 0.82, 0, 0, 0.42, 0.1, 0.55, 0.7, 2, 2014],
  ["b5143607", "white", 0.65, 0.68, 0, 0, 0.65, 0.6, 0.7, 0.6, 4, 2019],
];

const CANDS: C[] = [
  // reds
  ["5384d4e8", 0.475, 0.575, 0.75, 0.8, 0.7, 0.8, 0.8, 0.35, "Cabernet Sauvignon", "Napa Valley", "unknown_v1_bulk", "Cakebread 1997 Cabernet Sauvignon", 177],
  ["d1393f4a", 0.625, 0.7, 0.75, 0.8, 0.65, 0.6, 0.8, 0.35, "Cabernet Sauvignon", "Napa Valley", "unknown_v1_bulk", "Freemark Abbey 2010 Cabernet", 149],
  ["87357d62", 0.8, 0.75, 0.375, 0.45, 0.575, 0.3, 0.6, 0.3, "Pinot Noir", "Sonoma Coast", "unknown_v1_bulk", "Pahlmeyer 2013 Jayson Pinot Noir", 160],
  ["f08899e4", 0.475, 0.59, 0.825, 0.825, 0.675, 0.7, 0.875, 0.525, "Bordeaux-style Red Blend", "Napa Valley", "unknown_v1_bulk", "Joseph Phelps 2008 Insignia", 479],
  ["e230bd37", 0.5, 0.65, 0.8, 0.775, 0.725, 0.475, 0.775, 0.45, "Merlot", "Howell Mountain", "unknown_v1_bulk", "La Jota 2009 Merlot", 235],
  ["32ac2261", 0.4, 0.5, 0.8, 0.9, 0.8, 0.7, 0.85, 0.3, "Cabernet Sauvignon", "Lodi", "unknown_v1_bulk", "Earthquake 2012 Cabernet", 68],
  ["766ad257", 0.35, 0.55, 0.7, 0.9, 0.8, 0.85, 0.85, 0.3, "Cabernet Sauvignon", "Alexander Valley", "blinded_v2", "Silver Oak 2006 Cabernet", 200],
  ["91993b59", 0.65, 0.5075, 0.6525, 0.85, 0.665, 0.478, 0.724, 0.483, "Cabernet Sauvignon", "Alexander Valley", "unknown_v1_bulk", "Stonestreet 2005 Cabernet", 128],
  ["b6f7fa2c", 0.625, 0.65, 0.65, 0.75, 0.6, 0.4, 0.6765, 0.3865, "Cabernet Sauvignon", "Oak Knoll District", "unknown_v1_bulk", "Trefethen 2012 Cabernet", 132],
  ["e35299c8", 0.57, 0.5375, 0.7, 0.8, 0.7, 0.478, 0.8, 0.423, "Cabernet Sauvignon", "Napa Valley", "unknown_v1_bulk", "Venge 2013 Silencieux Cabernet", 225],
  ["40bb7cfb", 0.55, 0.675, 0.7, 0.65, 0.7, 0.425, 0.675, 0.6, "Cabernet Sauvignon", "Mendoza", "unknown_v1_bulk", "Catena Zapata 2008 Catena C", 75],
  // whites
  ["391ce93c", 0.85, 0.8, 0, 0, 0.35, 0.05, 0.45, 0.7, "Carricante", "Etna Bianco", "on_demand_blinded_v2", "Carricante 'Le Vigne Niche'", 210],
  ["c0b58872", 0.825, 0.7, 0, 0.3, 0.575, 0.025, 0.45, 0.075, "Kerner", "Alto Adige", "unknown_v1_bulk", "Abbazia di Novacella 2010 Kerner", 80],
  ["3aee2b8d", 0.78, 0.81, 0, 0, 0.38, 0.05, 0.4, 0.72, "Sylvaner", "Südtirol Alto Adige", "on_demand_blinded_v2", "Sylvaner 'Eisacktaler'", 90],
  ["798c8335", 0.661, 0.51, 0.202, 0.5, 0.48, 0.512, 0.344, 0.427, "Pinot Grigio", "Alto Adige", "unknown_v1_bulk", "Alois Lageder 2014 Porer", 95],
  ["62f28f55", 0.75, 0.64, 0, 0.325, 0.6, 0.3, 0.48, 0.3, "Pinot Grigio", "Collio", "unknown_v1_bulk", "Russiz Superiore 2015 Pinot Grigio", 102],
  ["d8b8d7f3", 0.8, 0.8, 0, 0.2, 0.6, 0.1, 0.5, 0.6, "Sauvignon", "Collio", "unknown_v1_bulk", "Venica & Venica 2015 Ronco", 148],
  ["87c49797", 0.75, 0.75, 0, 0.15, 0.55, 0.25, 0.6, 0.6, "Incrocio Manzoni", "Vigneti delle Dolomiti", "unknown_v1_bulk", "Foradori 2013 Fontanasanta", 108],
  ["5ebe58a8", 0.65, 0.55, 0, 0.3, 0.6, 0.5, 0.6, 0.1, "Garganega", "Soave", "unknown_v1_bulk", "Roccolo Grassi 2010 La Broia", 65],
  ["8a16804c", 0.7, 0.75, 0, 0, 0.55, 0.1, 0.45, 0.55, "Arneis", "Roero Piedmont", "on_demand_blinded_v2", "Arneis", 78],
  ["bcfeb4c5", 0.78, 0.82, 0, 0, 0.45, 0.05, 0.48, 0.68, "Timorasso", "Piedmont", "on_demand_blinded_v2", "Timorasso 'Piccolo Derthona'", 68],
  ["9e1b28ff", 0.6, 0.7, 0, 0, 0.65, 0.7, 0.75, 0.55, "Chardonnay", "Piedmont", "on_demand_blinded_v2", "Chardonnay 'Divers'", 105],
  ["8c7eae1f", 0.8, 0.85, 0, 0, 0.45, 0.05, 0.4, 0.65, "Vermentino", "Riviera Ligure", "on_demand_blinded_v2", "Vermentino 'Vigneto Isasco'", 95],
  ["280e6745", 0.7, 0.675, 0, 0.2, 0.65, 0.2, 0.554, 0.2, "Verdicchio", "Castelli di Jesi", "unknown_v1_bulk", "Umani Ronchi 2013 Casal di Serra", 75],
  ["ded2dfe5", 0.55, 0.6, 0, 0.25, 0.65, 0.65, 0.6, 0.5, "Vernaccia", "Vernaccia di San Gimignano", "unknown_v1_bulk", "Montenidoli 2011 Carato", 160],
  ["1e26812e", 0.85, 0.8, 0, 0.3, 0.3, 0, 0.3, 0.1, "Falanghina", "Sannio", "unknown_v1_bulk", "Capolino Perlingieri 2011 Preta", 65],
  ["a181a2d8", 0.825, 0.75, 0, 0.2, 0.6, 0.05, 0.5, 0.3, "Grillo", "Sicilia", "unknown_v1_bulk", "Donnafugata 2015 Sur Sur", 92],
  ["23b73f07", 0.85, 0.8, 0, 0, 0.35, 0.05, 0.35, 0.65, "Carricante", "Sicily", "on_demand_blinded_v2", "Carricante Etna Bianco", 198],
  ["d487ffcc", 0.8, 0.78, 0, 0, 0.35, 0.1, 0.4, 0.68, "Carricante/Catarratto", "Sicily", "on_demand_blinded_v2", "Carricante/Catarratto Etna", 118],
  ["56489ded", 0.5, 0.5, 0, 0, 0.7, 0.65, 0.75, 0.55, "Chardonnay", "Langhe Piedmont", "on_demand_blinded_v2", "Chardonnay 'Gaia & Rey'", 690],
  ["3939de8f", 0.85, 0.8, 0, 0, 0.5, 0.05, 0.4, 0.6, "Kerner", "Südtirol Alto Adige", "on_demand_blinded_v2", "Kerner 'Puntscheit'", 95],
  ["57fa4066", 0.78, 0.81, 0, 0, 0.38, 0.08, 0.37, 0.58, "Pinot Grigio", "Alto Adige", "on_demand_blinded_v2", "Pinot Grigio 'Tradition'", 70],
  ["7d533f20", 0.7, 0.75, 0, 0, 0.6, 0.05, 0.45, 0.6, "Friulano", "Friuli-Venezia Giulia", "on_demand_blinded_v2", "Friulano 'La Duline'", 98],
  ["9fae1a07", 0.78, 0.8, 0, 0, 0.45, 0.05, 0.4, 0.65, "Sauvignon Blanc", "Langhe Piedmont", "on_demand_blinded_v2", "Sauvignon Blanc 'Alteni'", 405],
  ["adc52a94", 0.78, 0.82, 0, 0, 0.38, 0.05, 0.42, 0.65, "Pecorino", "Terre di Chieti", "on_demand_blinded_v2", "Pecorino 'Vellodoro'", 60],
];

const ratedRow = (r: R): { bottle: FpRow; stars: number } => ({
  bottle: {
    id: r[0], name: r[0], producer: null, region: null, vintage: r[11], type: r[1],
    fp_fresh: r[2], fp_acid: r[3], fp_tannin: r[4], fp_fruit_dark: r[5],
    fp_ripe: r[6], fp_oak: r[7], fp_body: r[8], fp_savory: r[9],
  },
  stars: r[10],
});

const candRow = (c: C): FpRow => ({
  id: c[0], name: c[12], producer: null, region: c[10], vintage: null,
  type: c[3] > 0 || c[9].includes("Cabernet") || c[9].includes("Merlot") || c[9].includes("Pinot Noir") || c[9].includes("Bordeaux") ? "red" : "white",
  fp_fresh: c[1], fp_acid: c[2], fp_tannin: c[3], fp_fruit_dark: c[4],
  fp_ripe: c[5], fp_oak: c[6], fp_body: c[7], fp_savory: c[8],
});

// Reds are the first 11 entries; force type explicitly rather than infer.
const RED_IDS = new Set(CANDS.slice(0, 11).map((c) => c[0]));

const rated = [...RATED_RED, ...RATED_WHITE].map(ratedRow);
const targets = CANDS.map((c) => ({ ...candRow(c), type: RED_IDS.has(c[0]) ? "red" : "white" }));
const meta = new Map(CANDS.map((c) => [c[0], { grape: c[9], region: c[10], pipeline: c[11], name: c[12], price: c[13] }]));

const res = predictStarsMany(rated, targets);

type Scored = { id: string; predicted: number; type: string; grape: string; region: string; pipeline: string; name: string; price: number | null };
const scored: Scored[] = [];
for (const t of targets) {
  const p = res.get(t.id);
  const m = meta.get(t.id)!;
  if (p?.predicted == null) {
    console.log(`  (no prediction) ${m.name} — ${p?.nullReason ?? "?"}`);
    continue;
  }
  scored.push({ id: t.id, predicted: p.predicted, type: t.type!, ...m });
}

const report = (label: string, rows: Scored[]) => {
  if (rows.length === 0) return;
  const s = [...rows].sort((a, b) => b.predicted - a.predicted);
  const vals = s.map((r) => r.predicted);
  const min = Math.min(...vals), max = Math.max(...vals);
  const call = s[0];
  const within = (eps: number) => s.filter((r) => call.predicted - r.predicted <= eps);
  console.log(`\n=== ${label} — n=${rows.length}`);
  console.log(`min ${min.toFixed(3)}  max ${max.toFixed(3)}  spread ${(max - min).toFixed(3)}`);
  console.log(`the Call: ${call.name} (${call.predicted.toFixed(3)})`);
  for (const eps of [0.05, 0.1, 0.25, 0.5]) {
    console.log(`  within ${eps} of the Call: ${within(eps).length}`);
  }
  const cluster = within(0.1);
  const bulk = cluster.filter((r) => r.pipeline === "unknown_v1_bulk").length;
  console.log(`  cluster pipeline: ${bulk} bulk-v1 / ${cluster.length - bulk} real (blinded_v2 or on_demand)`);
  const grapes = new Map<string, number>(), regions = new Map<string, number>();
  for (const r of cluster) {
    grapes.set(r.grape, (grapes.get(r.grape) ?? 0) + 1);
    regions.set(r.region, (regions.get(r.region) ?? 0) + 1);
  }
  console.log(`  distinct grapes in cluster: ${grapes.size} → ${[...grapes].map(([g, n]) => `${g}×${n}`).join(", ")}`);
  console.log(`  distinct regions in cluster: ${regions.size}`);
  console.log(`  cluster rows:`);
  for (const r of cluster) {
    console.log(`    ${r.predicted.toFixed(3)}  ${r.pipeline === "unknown_v1_bulk" ? "BULK" : "real"}  ${r.name} — ${r.grape} / ${r.region} ${r.price ?? "?"}`);
  }
  // Whole-list pipeline split.
  const b = rows.filter((r) => r.pipeline === "unknown_v1_bulk");
  const bs = b.map((r) => r.predicted), rs = rows.filter((r) => r.pipeline !== "unknown_v1_bulk").map((r) => r.predicted);
  const sd = (v: number[]) => {
    if (v.length < 2) return 0;
    const m = v.reduce((a, x) => a + x, 0) / v.length;
    return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
  };
  console.log(`  full-list sd: bulk ${sd(bs).toFixed(3)} (n=${bs.length}) vs real ${sd(rs).toFixed(3)} (n=${rs.length})`);
};

report("ALL (both colours, one ranking — display only)", scored);
report("REDS", scored.filter((r) => r.type === "red"));
report("WHITES", scored.filter((r) => r.type !== "red"));
