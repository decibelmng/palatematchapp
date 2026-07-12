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
import { styleNameFor } from "./lane-style";
import {
  buildTypeContext,
  distanceInContext,
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
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function typeLabel(type: PaletteType, plural = true): string {
  if (type === "red") return plural ? "Reds" : "Red";
  return plural ? "Whites" : "White";
}

function benchmarkDisplay(b: BriefBenchmark): string {
  // "Producer Name" or bare name; trim to keep the brief tight.
  const producer = (b.producer ?? "").trim();
  const name = (b.name ?? "").trim();
  if (producer && name && !name.toLowerCase().startsWith(producer.toLowerCase())) {
    return `${producer} ${name}`;
  }
  return name || producer || "an unnamed wine";
}

/** Short region/producer hint for "think X" clauses. */
function styleRegionHint(b: BriefBenchmark): string {
  const region = (b.region ?? "").trim();
  if (region) return region;
  const producer = (b.producer ?? "").trim();
  return producer;
}

// ────────── Canon clustering (mirrors lanes.ts logic) ──────────

type CanonCluster = {
  label: BriefBenchmark;
  members: BriefBenchmark[];
};

function clusterCanons(canons: BriefBenchmark[], ctx: TypeCtx): CanonCluster[] {
  const n = canons.length;
  if (n === 0) return [];
  // Union-find on ω-distance < h
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
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
  // For each cluster, label = most-recent canon (canons already ordered desc)
  return Array.from(groups.values()).map((members) => ({
    label: members[0],
    members,
  }));
}

// ────────── Vocabulary maps ──────────

/** Fingerprint-axis (FpKey) → sommelier-facing "what matters most" phrase. */
const OMEGA_PHRASE: Record<FpKey, string> = {
  fresh: "freshness",
  acid: "acidity",
  tannin: "the texture of tannin",
  fruit_dark: "dark vs. red fruit character",
  ripe: "ripeness",
  oak: "restraint around oak",
  body: "weight on the palate",
  savory: "savory vs. fruit-driven character",
};

/** Bimodal descriptor per palate-code axis (used when letter === "X"). */
const BIMODAL_PHRASE: Record<string, string> = {
  body: "both light and bold weights",
  fruit_char: "both fruit-forward and earthy styles",
  tannin: "both silky and grippy tannins",
  oak: "both unoaked and oaked styles",
  acidity: "both round and crisp acidities",
  sweet: "both dry and sweet",
};

// ────────── Style-summary sentence ──────────

function pickCoreDescriptors(letters: LetterResult[], type: PaletteType): string[] {
  // Non-bimodal, resolved descriptors for the "core" three axes:
  // body, fruit_char, and the type's structural axis (tannin for red, oak for white).
  const structural = type === "red" ? "tannin" : "oak";
  const order = ["body", "fruit_char", structural];
  const out: string[] = [];
  for (const key of order) {
    const l = letters.find((x) => x.axis === key);
    if (!l || !l.resolved || l.bimodal) continue;
    if (l.letter === "N") continue; // skip "balanced" filler
    out.push(l.descriptor);
  }
  return out;
}

function orientationSentence(letters: LetterResult[]): string {
  // Combine acidity + sweet into one short trailing clause.
  const acidity = letters.find((l) => l.axis === "acidity");
  const sweet = letters.find((l) => l.axis === "sweet");

  const acidClause = (() => {
    if (!acidity?.resolved) return null;
    if (acidity.bimodal) return "crisp and round acidity both work";
    if (acidity.letter === "N") return "balanced acidity";
    return acidity.letter === "C" ? "always with lift" : "on the rounder side";
  })();

  const sweetClause = (() => {
    if (!sweet?.resolved) return null;
    if (sweet.bimodal) return "dry or sweet both fine";
    if (sweet.letter === "D") return "always dry";
    if (sweet.letter === "W") return "off-dry to sweet welcome";
    return "mostly dry";
  })();

  const parts = [acidClause, sweetClause].filter((x): x is string => !!x);
  if (parts.length === 0) return "";
  return parts.join("; ") + ".";
}

function styleSummarySentence(
  type: PaletteType,
  letters: LetterResult[],
  clusters: CanonCluster[],
): string {
  const bimodalAxes = letters.filter((l) => l.resolved && l.bimodal);
  const hasBimodal = bimodalAxes.length > 0;
  const twoStyles = hasBimodal && clusters.length >= 2;

  if (twoStyles) {
    // Two Canon-anchored styles, one per cluster.
    const pick = clusters.slice(0, 2).map((c) => {
      const styleName = styleNameFor(c.label.fp, type === "red" ? "red" : "white");
      const hint = styleRegionHint(c.label);
      const styled = styleName.toLowerCase();
      return hint ? `${styled} (think ${hint})` : styled;
    });
    return `I love two distinct styles — ${pick[0]} and ${pick[1]}.`;
  }

  // Single-style shape: descriptors from body / fruit / structural axis.
  const desc = pickCoreDescriptors(letters, type);
  const bimodalTail = bimodalAxes.map((l) => BIMODAL_PHRASE[l.axis]).filter(Boolean);

  if (desc.length === 0 && bimodalTail.length === 0) {
    // Fall back to a bare canon reference if one exists.
    if (clusters[0]) {
      const styleName = styleNameFor(clusters[0].label.fp, type === "red" ? "red" : "white");
      return `I gravitate to ${styleName.toLowerCase()}.`;
    }
    return "";
  }

  const leadParts: string[] = [];
  if (desc.length > 0) leadParts.push(`I lean ${joinList(desc)}`);
  for (const b of bimodalTail) leadParts.push(`I enjoy ${b}`);
  return leadParts.join("; ") + ".";
}

// ────────── Benchmarks line ──────────

/** Pick up to 5 canons, prefer diversity when clusters > 1. */
function selectBenchmarks(canons: BriefBenchmark[], clusters: CanonCluster[], limit = 5): BriefBenchmark[] {
  if (canons.length <= limit) return canons;
  if (clusters.length <= 1) return canons.slice(0, limit);
  // Round-robin across clusters (each cluster already recency-ordered).
  const buckets = clusters.map((c) => [...c.members]);
  const out: BriefBenchmark[] = [];
  while (out.length < limit) {
    let progressed = false;
    for (const bucket of buckets) {
      if (out.length >= limit) break;
      const next = bucket.shift();
      if (next) {
        out.push(next);
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return out;
}

function benchmarksSentence(canons: BriefBenchmark[], clusters: CanonCluster[]): string {
  if (canons.length === 0) return "";
  const picked = selectBenchmarks(canons, clusters);
  const names = picked.map(benchmarkDisplay);
  return `Benchmarks I love: ${joinList(names)}.`;
}

// ────────── Dealbreakers line ──────────

function dealbreakerPhrase(n: BriefBenchmark, type: PaletteType): string {
  const styleName = styleNameFor(n.fp, type === "red" ? "red" : "white").toLowerCase();
  const hint = styleRegionHint(n);
  return hint ? `${styleName} (e.g., ${hint})` : styleName;
}

function dealbreakersSentence(nemeses: BriefBenchmark[], type: PaletteType): string {
  if (nemeses.length === 0) return "";
  // Dedupe phrases (two nemeses in the same style shouldn't repeat).
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const n of nemeses) {
    const p = dealbreakerPhrase(n, type);
    const norm = p.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    phrases.push(p);
    if (phrases.length === 2) break;
  }
  return `Please steer me away from: ${joinList(phrases)}.`;
}

// ────────── "What matters most" line ──────────

function omegaSentence(ctx: TypeCtx | null): string {
  if (!ctx) return "";
  const omega = ctx.fit.omega;
  const active = ctx.fit.active;
  if (active.length < 2) return "";
  const ranked = [...active].sort((a, b) => omega[b] - omega[a]);
  // Only surface it if the top axis meaningfully exceeds the median.
  const median = [...active].map((k) => omega[k]).sort((a, b) => a - b)[Math.floor(active.length / 2)];
  if (omega[ranked[0]] <= median * 1.05) return "";
  const top = ranked.slice(0, 2).map((k) => OMEGA_PHRASE[k]);
  return `What matters most to me: ${joinList(top)}.`;
}

// ────────── Public builders ──────────

/** Build one type's brief, or null when insufficient data. */
export function buildTypeBrief(input: TypeBriefInputs): TypeBrief | null {
  const { type, rated, ratedFp, canons, nemeses } = input;
  if (rated.length < BRIEF_MIN_RATINGS) return null;

  const { letters } = computeCode(rated, axesFor(type));
  const ctx = buildTypeContext(ratedFp, type === "red" ? "red" : "white");
  const clusters = ctx ? clusterCanons(canons, ctx) : [];

  const sentences = [
    styleSummarySentence(type, letters, clusters),
    orientationSentence(letters),
    benchmarksSentence(canons, clusters),
    dealbreakersSentence(nemeses, type),
    omegaSentence(ctx),
  ].filter((s) => s.trim().length > 0);

  if (sentences.length === 0) return null;

  const paragraph = `${typeLabel(type)}: ${sentences.join(" ")}`;
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

/** Assemble the full brief. Combines available types, appends the footer. */
export function buildFullBrief(input: FullBriefInputs): FullBrief {
  const maxWords = input.maxWords ?? 120;
  const paragraphs: TypeBrief[] = [];
  if (input.red) {
    const r = buildTypeBrief(input.red);
    if (r) paragraphs.push(r);
  }
  if (input.white) {
    const w = buildTypeBrief(input.white);
    if (w) paragraphs.push(w);
  }
  const body = paragraphs.map((p) => p.text).join("\n\n");
  const wordCount = words(body);
  const overBudget = wordCount > maxWords;
  const text = body ? `${body}\n\n${FOOTER}` : "";
  return { paragraphs, text, wordCount, overBudget };
}
