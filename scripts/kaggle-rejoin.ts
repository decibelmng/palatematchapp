/* eslint-disable no-console */
//
// Stage 1 of the catalog re-fingerprint (see docs/CATALOG_REFINGERPRINT.md).
//
// Rejoin real per-wine tasting notes from Kaggle's winemag-data-130k-v2.csv to
// catalog `bottles`, by normalized producer + vintage + grape, confirmed by
// wine-name similarity.
//
// SAFETY: DRY-RUN by default — prints a report and writes nothing. With --write
// it upserts ONLY into the `catalog_kaggle_notes` staging table. It never writes
// `bottles` and never touches any fp_* column.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     bun run scripts/kaggle-rejoin.ts <path-to-winemag-data-130k-v2.csv> [--write] [--min=0.72]
//
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---------- args ----------
const args = process.argv.slice(2);
const csvPath = args.find((a) => !a.startsWith("--"));
const WRITE = args.includes("--write");
const MIN = Number((args.find((a) => a.startsWith("--min=")) ?? "--min=0.72").split("=")[1]);
if (!csvPath) {
  console.error("Usage: bun run scripts/kaggle-rejoin.ts <csv> [--write] [--min=0.72]");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}
const sb = createClient(url, key);

// ---------- text helpers ----------
const STOP = new Set([
  "the","a","an","de","di","du","del","della","el","la","le","les","y","e","and","of","vin","vino",
  "wine","cuvee","cuvée","reserve","reserva","riserva","estate","vineyards","vineyard","winery",
  "cellars","domaine","chateau","château","ch","tenuta","azienda","agricola","weingut","bodega",
  "bodegas","selection","label","bottling","rosso","bianco","blanc","rouge","rose","rosato","rosado",
]);
function normalize(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string | null | undefined): Set<string> {
  return new Set(normalize(s).split(" ").filter((t) => t && !STOP.has(t)));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
function vintageOf(title: string): number | null {
  const m = title.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

// ---------- minimal RFC4180 CSV parser ----------
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); field = ""; row = []; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => { o[h || "_idx"] = r[i] ?? ""; });
    return o;
  });
}

// ---------- load Kaggle rows ----------
type KRow = { title: string; description: string; winery: string; variety: string; region: string; points: number | null; vintage: number | null; nameTok: Set<string> };
console.log(`Reading ${csvPath} …`);
const kaggle: KRow[] = parseCsv(readFileSync(csvPath, "utf8"))
  .filter((r) => r.description && r.winery)
  .map((r) => ({
    title: r.title ?? "",
    description: r.description,
    winery: r.winery,
    variety: r.variety ?? "",
    region: r.province || r.region_1 || "",
    points: r.points ? Number(r.points) : null,
    vintage: vintageOf(r.title ?? ""),
    // Disambiguating tokens: designation (cuvée/vineyard) + variety.
    nameTok: tokens(`${r.designation ?? ""} ${r.variety ?? ""}`),
  }));
console.log(`  ${kaggle.length} usable Kaggle rows (with a description + winery).`);

// Index by normalized producer for fast candidate lookup.
const byProducer = new Map<string, KRow[]>();
for (const k of kaggle) {
  const p = normalize(k.winery);
  if (!p) continue;
  const arr = byProducer.get(p) ?? [];
  arr.push(k); byProducer.set(p, arr);
}

// ---------- score one bottle against its producer's Kaggle rows ----------
type Bottle = { id: string; name: string | null; producer: string | null; region: string | null; grape: string | null; vintage: number | null };
function bestMatch(b: Bottle): { k: KRow; score: number } | null {
  const cands = byProducer.get(normalize(b.producer));
  if (!cands || cands.length === 0) return null; // require a producer match — high precision
  const bName = tokens(`${b.name ?? ""} ${b.grape ?? ""}`);
  const bGrape = tokens(b.grape);
  const bRegion = tokens(b.region);
  let best: { k: KRow; score: number } | null = null;
  for (const k of cands) {
    // Vintage: if both known and different, this can't be the same wine.
    if (b.vintage != null && k.vintage != null && b.vintage !== k.vintage) continue;
    let score = 0.5; // exact normalized producer match
    if (b.vintage != null && k.vintage === b.vintage) score += 0.25;
    score += 0.15 * jaccard(bName, k.nameTok);
    score += 0.10 * jaccard(bGrape, tokens(k.variety));
    score += 0.05 * jaccard(bRegion, tokens(k.region)); // small bonus; capped total below
    score = Math.min(score, 1);
    if (!best || score > best.score) best = { k, score };
  }
  return best;
}

// ---------- stream bottles, match, collect ----------
type Match = { bottle_id: string; kaggle_title: string; description: string; points: number | null; match_confidence: number };
const matches: Match[] = [];
const buckets = [0.5, 0.6, 0.7, 0.8, 0.9, 1.01]; // confidence histogram edges
const hist = new Array(buckets.length).fill(0);
const sampleMatched: string[] = [];
const sampleUnmatched: string[] = [];
let totalBottles = 0, matchedCount = 0;

const PAGE = 1000;
for (let from = 0; ; from += PAGE) {
  const { data, error } = await sb
    .from("bottles")
    .select("id,name,producer,region,grape,vintage")
    .range(from, from + PAGE - 1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || data.length === 0) break;
  for (const b of data as Bottle[]) {
    totalBottles++;
    const m = bestMatch(b);
    if (m && m.score >= MIN) {
      matchedCount++;
      matches.push({
        bottle_id: b.id, kaggle_title: m.k.title, description: m.k.description,
        points: m.k.points, match_confidence: Math.round(m.score * 1000) / 1000,
      });
      hist[buckets.findIndex((e) => m.score < e)]++;
      if (sampleMatched.length < 20 && Math.random() < 0.03) {
        sampleMatched.push(`  [${m.score.toFixed(2)}] "${b.producer} — ${b.name} ${b.vintage ?? ""}"  ↔  "${m.k.title}"`);
      }
    } else if (sampleUnmatched.length < 10 && Math.random() < 0.01) {
      sampleUnmatched.push(`  "${b.producer} — ${b.name} ${b.vintage ?? ""}" (best ${m ? m.score.toFixed(2) : "—"})`);
    }
  }
  console.log(`  scanned ${totalBottles} bottles, ${matchedCount} matched…`);
}

// ---------- report ----------
console.log("\n──────── REPORT ────────");
console.log(`Bottles:        ${totalBottles}`);
console.log(`Matched (≥${MIN}): ${matchedCount}  (${((matchedCount / Math.max(1, totalBottles)) * 100).toFixed(1)}%)`);
console.log("Confidence histogram:");
const labels = ["0.5–0.6", "0.6–0.7", "0.7–0.8", "0.8–0.9", "0.9–1.0", "1.0"];
hist.forEach((n, i) => console.log(`  ${labels[i]}: ${n}`));
console.log("\nSample MATCHES (eyeball these — are they the same wine?):");
sampleMatched.forEach((s) => console.log(s));
console.log("\nSample UNMATCHED (below threshold or no producer match):");
sampleUnmatched.forEach((s) => console.log(s));

// ---------- write (only with --write) ----------
if (!WRITE) {
  console.log(`\nDRY RUN — nothing written. Re-run with --write once the samples look right.`);
  process.exit(0);
}
console.log(`\nWriting ${matches.length} rows to catalog_kaggle_notes …`);
for (let i = 0; i < matches.length; i += 500) {
  const chunk = matches.slice(i, i + 500);
  const { error } = await sb.from("catalog_kaggle_notes").upsert(chunk, { onConflict: "bottle_id" });
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`  upserted ${Math.min(i + 500, matches.length)}/${matches.length}`);
}
console.log("Done. Nothing in bottles or fp_* was touched.");
