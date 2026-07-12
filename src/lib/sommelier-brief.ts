// Deterministic "For your sommelier" narrative builder.
// No LLM — every phrase is assembled from structured palate data so the
// output is instant, identical for identical inputs, and cannot claim
// anything the user's record doesn't support.

import {
  computeCode,
  axesFor,
  type PaletteType,
  type RatedBottle,
  type LetterResult,
} from "./palate";
import { styleNameFor, type FpVec } from "./lane-style";
import {
  buildTypeContext,
  distanceInContext,
  RAX,
  type FpKey,
  type RatedFp,
  type TypeCtx,
} from "./recommender";

// ────────── Public inputs ──────────

/** Minimum ratings for a type to appear in the brief. */
export const BRIEF_MIN_RATINGS = 4;

/** A benchmark (Canon or Nemesis) enriched with fingerprint + display fields. */
export type BriefBenchmark = {
  id: string;
  bottleId: string;
  name: string;
  producer: string | null;
  region: string | null;
  fp: Record<FpKey, number>;
  createdAt: string; // ISO string; used to order by recency of crowning
};

export type TypeBriefInputs = {
  type: PaletteType;
  /** For palate code (must include canon flag). */
  rated: RatedBottle[];
  /** For ω-context + clustering; same-type only. */
  ratedFp: RatedFp[];
  /** Ordered by recency of crowning desc. */
  canons: BriefBenchmark[];
  nemeses: BriefBenchmark[];
};

export type TypeBrief = {
  type: PaletteType;
  text: string;
  wordCount: number;
};

// ────────── Utility ──────────

const FOOTER = "My palate profile via Palate Match";

function words(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function joinList(items: string[]): string {
  const xs = items.filter((s) => s && s.trim().length > 0);
  if (xs.length === 0) return "";
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
}

function typeLabel(type: PaletteType, plural = true): string {
  if (type === "red") return plural ? "Reds" : "Red";
  return plural ? "Whites" : "White";
}

function capitalize(s: string): string {
  const t = s.trimStart();
  if (!t) return s;
  return t[0].toUpperCase() + t.slice(1);
}

/** Clean whitespace artifacts: collapse runs of spaces, fix "  (" → " (",
 *  fix " ," and " ." — cheap post-processor over final paragraphs. */
function tidyWhitespace(s: string): string {
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
}

/** Strip vintages/N.V. from a wine name so "Shafer Hillside Select 2016"
 *  reads as "Shafer Hillside Select". */
function stripVintage(name: string): string {
  return name
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\bN\.?V\.?\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function benchmarkDisplay(b: BriefBenchmark): string {
  const producer = (b.producer ?? "").trim();
  const name = stripVintage((b.name ?? "").trim());
  const region = (b.region ?? "").trim();
  // If the name is essentially just the producer, fall back to producer + region.
  const nameLooksLikeProducer = name && producer && name.toLowerCase() === producer.toLowerCase();
  if (nameLooksLikeProducer && region) return `${producer} ${region}`;
  if (producer && name && !name.toLowerCase().startsWith(producer.toLowerCase())) {
    return `${producer} ${name}`;
  }
  return name || producer || (region ? `a ${region} wine` : "an unnamed wine");
}

/** Short region/producer hint for "think X" / "e.g., X" clauses. */
function styleRegionHint(b: BriefBenchmark): string {
  const region = (b.region ?? "").trim();
  if (region) return region;
  return (b.producer ?? "").trim();
}

// ────────── Loved centroid ──────────

/** Mean fingerprint across loved (≥4★) rated wines. Missing → null. */
function lovedCentroid(ratedFp: RatedFp[]): FpVec | null {
  const loved = ratedFp.filter((r) => r.stars >= 4);
  if (loved.length === 0) return null;
  const out = {} as FpVec;
  for (const k of RAX) {
    let sum = 0;
    for (const r of loved) sum += r.fp[k];
    out[k] = sum / loved.length;
  }
  return out;
}

// ────────── Canon clustering (mirrors lanes.ts logic) ──────────

type CanonCluster = {
  label: BriefBenchmark;
  members: BriefBenchmark[];
  /** Cluster mean fingerprint (used for lane-style vocabulary). */
  centroid: FpVec;
};

function meanFp(items: { fp: FpVec }[]): FpVec {
  const out = {} as FpVec;
  for (const k of RAX) {
    let sum = 0;
    for (const m of items) sum += m.fp[k];
    out[k] = items.length ? sum / items.length : 0.5;
  }
  return out;
}

/** Cluster canons using the SAME grouping the /matches lane page produces:
 *  union-find over ratedFp canons at ω-distance < h. Then map each cluster
 *  root back to matching BriefBenchmark entries by id so the display prefers
 *  the recency-ordered benchmark label. Falls back to BriefBenchmark-only
 *  clustering when ratedFp canons are missing. */
function clusterCanons(
  canons: BriefBenchmark[],
  ratedFp: RatedFp[],
  ctx: TypeCtx,
): CanonCluster[] {
  const ratedCanons = ratedFp.filter((r) => r.canon);
  if (ratedCanons.length === 0) {
    // Fall back to clustering the BriefBenchmark list directly.
    return clusterByFp(canons, ctx);
  }

  const n = ratedCanons.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distanceInContext(ratedCanons[i].fp, ratedCanons[j].fp, ctx);
      if (d < ctx.h) union(i, j);
    }
  }
  const groups = new Map<number, RatedFp[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = groups.get(r) ?? [];
    arr.push(ratedCanons[i]);
    groups.set(r, arr);
  }

  const byId = new Map(canons.map((b) => [b.id, b] as const));
  const clusters: CanonCluster[] = [];
  for (const group of groups.values()) {
    const members: BriefBenchmark[] = [];
    for (const r of group) {
      const b = byId.get(r.id);
      if (b) members.push(b);
    }
    if (members.length === 0) continue;
    // Label = most-recent benchmark (input canons list is recency-desc).
    const label = members[0];
    clusters.push({ label, members, centroid: meanFp(group) });
  }
  return clusters;
}

/** BriefBenchmark-only fallback clustering. */
function clusterByFp(canons: BriefBenchmark[], ctx: TypeCtx): CanonCluster[] {
  const n = canons.length;
  if (n === 0) return [];
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = distanceInContext(canons[i].fp, canons[j].fp, ctx);
      if (d < ctx.h) union(i, j);
    }
  }
  const groups = new Map<number, BriefBenchmark[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const arr = groups.get(r) ?? [];
    arr.push(canons[i]);
    groups.set(r, arr);
  }
  return Array.from(groups.values()).map((members) => ({
    label: members[0],
    members,
    centroid: meanFp(members),
  }));
}

// ────────── Vocabulary maps ──────────

/** "What matters most" phrases keyed by the direction the user's loved
 *  centroid sits, contextualised against a Nemesis pushing further in
 *  that same direction ("without X"). */
const OMEGA_DIRECTIONAL: Record<FpKey, { hi: string; lo: string; hiVsHi?: string; loVsLo?: string }> = {
  fresh:      { hi: "freshness is non-negotiable", lo: "mature bottles over young ones" },
  acid:       { hi: "acidity to keep things lifted", lo: "rounder, less searing acidity", hiVsHi: "acidity without going searing" },
  tannin:     { hi: "structured tannin", lo: "silky tannin", hiVsHi: "structure without drying tannin" },
  fruit_dark: { hi: "dark-fruited character", lo: "red-fruited lift" },
  ripe:       { hi: "ripeness without jam", lo: "restraint over jammy ripeness", hiVsHi: "ripeness without jam" },
  oak:        { hi: "polish from oak, not planks", lo: "restraint around oak", hiVsHi: "oak that polishes, not planks" },
  body:       { hi: "weight without heaviness", lo: "lightness on the palate", hiVsHi: "weight without heaviness" },
  savory:     { hi: "savory depth", lo: "fruit-driven wines" },
};

/** Hedonic NEGATIVE vocabulary for dealbreakers, per axis + direction.
 *  Empty string → that direction isn't a meaningful complaint to voice. */
const NEG_PHRASE: Record<FpKey, { hi: string; lo: string }> = {
  ripe:       { hi: "jammy, confected fruit-bombs", lo: "" },
  fruit_dark: { hi: "syrupy, over-extracted dark fruit", lo: "" },
  tannin:     { hi: "drying tannin", lo: "" },
  acid:       { hi: "searing acidity", lo: "flabby, low-acid" },
  oak:        { hi: "over-oaked, buttery character", lo: "" },
  body:       { hi: "heavy, ponderous body", lo: "" },
  savory:     { hi: "", lo: "" },
  fresh:      { hi: "", lo: "tired, oxidative" },
};



// ────────── Style-summary sentence ──────────

function orientationClauses(letters: LetterResult[]): string[] {
  const clauses: string[] = [];
  const acidity = letters.find((l) => l.axis === "acidity");
  const sweet = letters.find((l) => l.axis === "sweet");

  if (acidity?.resolved) {
    if (acidity.bimodal) clauses.push("crisp and round acidity both work");
    else if (acidity.letter === "C") clauses.push("always with lift");
    else if (acidity.letter === "R") clauses.push("on the rounder side");
  }
  if (sweet?.resolved) {
    if (sweet.bimodal) clauses.push("dry or sweet both fine");
    else if (sweet.letter === "D") clauses.push("always dry");
    else if (sweet.letter === "W") clauses.push("off-dry to sweet welcome");
  }
  return clauses;
}

/** Compose the "I love …" opener from cluster lane vocabulary (bimodal) or
 *  from the loved-fingerprint centroid (single-mode). We NEVER read raw
 *  B/F/G/S palate-code letters here — the lane vocabulary already accounts
 *  for the full fingerprint, so "unoaked-steely" whites can't be labelled
 *  "bold, fruit-forward" by accident. */
function styleSummarySentence(
  type: PaletteType,
  clusters: CanonCluster[],
  ratedFp: RatedFp[],
): string {
  if (clusters.length >= 2) {
    const [a, b] = clusters;
    const nameA = styleNameFor(a.centroid, type).toLowerCase();
    const nameB = styleNameFor(b.centroid, type).toLowerCase();
    const hintA = styleRegionHint(a.label);
    const hintB = styleRegionHint(b.label);
    const styledA = hintA ? `${nameA} (think ${hintA})` : nameA;
    const styledB = hintB ? `${nameB} (think ${hintB})` : nameB;
    return `I love two distinct styles — ${styledA} and ${styledB}.`;
  }

  // Single-mode: prefer the sole cluster centroid; else use loved centroid.
  const centroid = clusters[0]?.centroid ?? lovedCentroid(ratedFp);
  if (!centroid) return "";
  const styleName = styleNameFor(centroid, type).toLowerCase();
  const hint = clusters[0] ? styleRegionHint(clusters[0].label) : "";
  return hint
    ? `I lean toward ${styleName} wines (think ${hint}).`
    : `I lean toward ${styleName} wines.`;
}

// ────────── Benchmarks line ──────────

/** One benchmark per lane: take the label (most-recent canon) from each
 *  cluster. When there are no clusters (e.g. ctx couldn't be built) fall
 *  back to name-level dedupe of the raw canon list. */
function selectBenchmarks(canons: BriefBenchmark[], clusters: CanonCluster[], limit = 5): BriefBenchmark[] {
  const seen = new Set<string>();
  const push = (arr: BriefBenchmark[], b: BriefBenchmark) => {
    const key = benchmarkDisplay(b).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    arr.push(b);
  };

  if (clusters.length > 0) {
    // Sort clusters by size desc so the most-established lanes go first.
    const sorted = [...clusters].sort((a, b) => b.members.length - a.members.length);
    const out: BriefBenchmark[] = [];
    for (const c of sorted) {
      if (out.length >= limit) break;
      push(out, c.label);
    }
    return out;
  }

  const out: BriefBenchmark[] = [];
  for (const c of canons) {
    if (out.length >= limit) break;
    push(out, c);
  }
  return out;
}

function benchmarksSentence(canons: BriefBenchmark[], clusters: CanonCluster[]): string {
  if (canons.length === 0) return "";
  const picked = selectBenchmarks(canons, clusters);
  const names = picked.map(benchmarkDisplay);
  return `Benchmarks I love: ${joinList(names)}.`;
}

// ────────── Dealbreakers as contrasts ──────────

/** For one nemesis, compute a phrase describing what it does differently
 *  from the loved centroid, using hedonic negative vocabulary. Returns
 *  null if no axis clears the "meaningfully different" threshold. */
function nemesisContrastPhrase(
  n: BriefBenchmark,
  centroid: FpVec,
  ctx: TypeCtx | null,
): string | null {
  const active = ctx?.fit.active ?? (RAX as readonly FpKey[]);
  const omega = ctx?.fit.omega ?? null;

  type Cand = { axis: FpKey; dir: "hi" | "lo"; delta: number; weighted: number; phrase: string };
  const cands: Cand[] = [];
  for (const k of active) {
    const raw = n.fp[k] - centroid[k];
    const abs = Math.abs(raw);
    if (abs < 0.14) continue; // must be meaningfully different, not noise
    const dir: "hi" | "lo" = raw > 0 ? "hi" : "lo";
    const phrase = NEG_PHRASE[k]?.[dir] ?? "";
    if (!phrase) continue;
    const w = omega ? omega[k] : 1;
    cands.push({ axis: k, dir, delta: abs, weighted: abs * (w || 1), phrase });
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.weighted - a.weighted);

  const hint = styleRegionHint(n);
  const [p1, p2] = cands;
  const core = p2 ? `${p1.phrase} with ${p2.phrase}` : p1.phrase;
  return hint ? `${core} (e.g., ${hint})` : core;
}

function dealbreakersSentence(
  nemeses: BriefBenchmark[],
  centroid: FpVec | null,
  ctx: TypeCtx | null,
): string {
  if (nemeses.length === 0 || !centroid) return "";
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const n of nemeses) {
    const p = nemesisContrastPhrase(n, centroid, ctx);
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(p);
    if (phrases.length === 2) break;
  }
  if (phrases.length === 0) return "";
  return `Please steer me away from: ${joinList(phrases)}.`;
}

// ────────── "What matters most" line ──────────

/** Directional phrase for one axis given the loved centroid and the
 *  nemesis centroid on that axis. Uses "hiVsHi" / "loVsLo" variants when
 *  the nemesis pushes further in the same direction the user already
 *  loves — this is where "X without Y" phrasing lands. */
function directionalPhrase(
  axis: FpKey,
  lovedVal: number,
  nemesisVal: number | null,
): string {
  const dir: "hi" | "lo" = lovedVal >= 0.5 ? "hi" : "lo";
  const table = OMEGA_DIRECTIONAL[axis];
  if (nemesisVal !== null) {
    if (dir === "hi" && nemesisVal >= lovedVal + 0.1 && table.hiVsHi) return table.hiVsHi;
    if (dir === "lo" && nemesisVal <= lovedVal - 0.1 && table.loVsLo) return table.loVsLo;
  }
  return table[dir];
}

function omegaSentence(
  ctx: TypeCtx | null,
  centroid: FpVec | null,
  nemeses: BriefBenchmark[],
): string {
  if (!ctx || !centroid) return "";
  const omega = ctx.fit.omega;
  const active = ctx.fit.active;
  if (active.length < 2) return "";
  const ranked = [...active].sort((a, b) => omega[b] - omega[a]);
  const median = [...active].map((k) => omega[k]).sort((a, b) => a - b)[Math.floor(active.length / 2)];
  if (omega[ranked[0]] <= median * 1.05) return "";

  // Nemesis centroid (if any) — used to steer "without X" phrasing.
  const nemFp: FpVec | null = nemeses.length
    ? meanFp(nemeses.map((n) => ({ fp: n.fp })))
    : null;

  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const axis of ranked) {
    const p = directionalPhrase(axis, centroid[axis], nemFp ? nemFp[axis] : null);
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push(p);
    if (phrases.length === 2) break;
  }
  if (phrases.length === 0) return "";
  // Word cap: keep the sentence ≤ ~18 words including the lead.
  const sentence = `I want ${joinList(phrases)}.`;
  return sentence;
}


// ────────── Public builders ──────────

type BuildOpts = {
  /** Phrases already emitted in a sibling paragraph — for cross-paragraph
   *  dedupe of small orientation clauses like "always with lift". */
  usedClauses?: Set<string>;
};

/** Build one type's brief, or null when insufficient data. */
export function buildTypeBrief(input: TypeBriefInputs, opts: BuildOpts = {}): TypeBrief | null {
  const { type, rated, ratedFp, canons, nemeses } = input;
  if (rated.length < BRIEF_MIN_RATINGS) return null;

  const { letters } = computeCode(rated, axesFor(type));
  const ctx = buildTypeContext(ratedFp, type === "red" ? "red" : "white");
  const clusters = ctx ? clusterCanons(canons, ctx) : [];
  const centroid = lovedCentroid(ratedFp);

  const style = styleSummarySentence(type, clusters, ratedFp);

  // Orientation clauses — dedupe against sibling paragraph.
  const rawClauses = orientationClauses(letters);
  const kept: string[] = [];
  for (const c of rawClauses) {
    const key = c.toLowerCase();
    if (opts.usedClauses?.has(key)) continue;
    opts.usedClauses?.add(key);
    kept.push(c);
  }
  const orientation = kept.length > 0 ? capitalize(kept.join("; ")) + "." : "";

  const benches = benchmarksSentence(canons, clusters);
  const dealbreakers = dealbreakersSentence(nemeses, centroid, ctx);
  const omega = omegaSentence(ctx);

  const sentences = [style, orientation, benches, dealbreakers, omega]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s, i) => (i === 0 ? capitalize(s) : s));

  if (sentences.length === 0) return null;

  const paragraph = tidyWhitespace(`${typeLabel(type)}: ${sentences.join(" ")}`);
  return { type, text: paragraph, wordCount: words(paragraph) };
}

export type FullBriefInputs = {
  red: TypeBriefInputs | null;
  white: TypeBriefInputs | null;
  /** Word budget for the palate content (footer excluded). */
  maxWords?: number;
};

export type FullBrief = {
  paragraphs: TypeBrief[];
  text: string;      // full text incl. footer
  wordCount: number; // palate content only, footer excluded
  overBudget: boolean;
};

/** Assemble the full brief. Combines available types, appends the footer.
 *  Small orientation clauses are deduped across paragraphs so a two-type
 *  user with the same acidity preference doesn't see "always with lift"
 *  twice. */
export function buildFullBrief(input: FullBriefInputs): FullBrief {
  const maxWords = input.maxWords ?? 120;
  const paragraphs: TypeBrief[] = [];
  const usedClauses = new Set<string>();
  if (input.red) {
    const r = buildTypeBrief(input.red, { usedClauses });
    if (r) paragraphs.push(r);
  }
  if (input.white) {
    const w = buildTypeBrief(input.white, { usedClauses });
    if (w) paragraphs.push(w);
  }
  const body = paragraphs.map((p) => p.text).join("\n\n");
  const wordCount = words(body);
  const overBudget = wordCount > maxWords;
  const text = body ? `${body}\n\n${FOOTER}` : "";
  return { paragraphs, text, wordCount, overBudget };
}
