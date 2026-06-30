// Cuvée-level identity helpers. A "cuvée" is producer + label + region —
// vintages of the same wine collapse into one cuvée; different bottlings
// from the same producer (Barolo vs Barbaresco vs Bric Turot) do not.

import { RAX, type FpKey, type WineType } from "@/lib/recommender";

const NAME_STOPWORDS = new Set([
  "the", "a", "an", "de", "di", "du", "del", "della", "el", "la", "le", "les",
  "y", "and", "of", "vin", "vino", "wine", "cuvee", "cuvée",
  "estate", "vineyards", "vineyard", "winery", "cellars",
  "bottling", "selection", "label",
]);

function norm(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(19|20)\d{2}\b/g, " ")  // strip vintage years
    .replace(/\bn\.?\s*v\.?\b/g, " ")    // strip NV
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameTokens(s: string | null | undefined): string {
  return norm(s).split(" ").filter((t) => t.length > 0 && !NAME_STOPWORDS.has(t)).join(" ");
}

export function cuveeKey(b: {
  producer?: string | null;
  name: string;
  region?: string | null;
  type?: string | null;
}): string {
  return [
    norm(b.producer),
    nameTokens(b.name),
    norm(b.region),
    (b.type ?? "red").toLowerCase(),
  ].join("|");
}

/** Strip a trailing/leading 4-digit year from a display name. */
export function stripVintageFromName(name: string): string {
  return name.replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
}

// ---------- Aggregation ----------

export type CuveeRated = {
  cuvee: string;
  id: string;            // representative bottle id (newest vintage)
  name: string;          // vintage stripped
  producer: string | null;
  region: string | null;
  type: WineType;
  fp: Record<FpKey, number>;
  stars: number;         // average
  bottleIds: string[];   // every rated bottle in this cuvée
  vintages: number[];    // sorted desc
};

export type CuveeCandidate = {
  cuvee: string;
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  type: WineType;
  fp: Record<FpKey, number>;
  critic_score: number | null;
  vintages: number[];    // sorted desc
};

type RatedInput = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  type: WineType;
  vintage?: number | null;
  fp: Record<FpKey, number>;
  stars: number;
};
type CandidateInput = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  type: WineType;
  vintage?: number | null;
  fp: Record<FpKey, number>;
  critic_score?: number | null;
};

function meanFp(rows: { fp: Record<FpKey, number> }[]): Record<FpKey, number> {
  const out = {} as Record<FpKey, number>;
  for (const k of RAX) {
    let s = 0;
    for (const r of rows) s += r.fp[k];
    out[k] = s / rows.length;
  }
  return out;
}

function pickRep<T extends { vintage?: number | null; id: string }>(rows: T[]): T {
  return [...rows].sort((a, b) => (b.vintage ?? -1) - (a.vintage ?? -1))[0];
}

export function aggregateRated(rows: RatedInput[]): CuveeRated[] {
  const groups = new Map<string, RatedInput[]>();
  for (const r of rows) {
    const k = cuveeKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: CuveeRated[] = [];
  for (const [k, grp] of groups) {
    const rep = pickRep(grp);
    const vintages = Array.from(new Set(grp.map((g) => g.vintage).filter((v): v is number => !!v))).sort((a, b) => b - a);
    const avgStars = grp.reduce((s, g) => s + g.stars, 0) / grp.length;
    out.push({
      cuvee: k,
      id: rep.id,
      name: stripVintageFromName(rep.name),
      producer: rep.producer,
      region: rep.region,
      type: rep.type,
      fp: meanFp(grp),
      stars: avgStars,
      bottleIds: grp.map((g) => g.id),
      vintages,
    });
  }
  return out;
}

export function aggregateCandidates(rows: CandidateInput[]): CuveeCandidate[] {
  const groups = new Map<string, CandidateInput[]>();
  for (const r of rows) {
    const k = cuveeKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: CuveeCandidate[] = [];
  for (const [k, grp] of groups) {
    const rep = pickRep(grp);
    const vintages = Array.from(new Set(grp.map((g) => g.vintage).filter((v): v is number => !!v))).sort((a, b) => b - a);
    const critics = grp.map((g) => g.critic_score).filter((c): c is number => typeof c === "number");
    out.push({
      cuvee: k,
      id: rep.id,
      name: stripVintageFromName(rep.name),
      producer: rep.producer,
      region: rep.region,
      type: rep.type,
      fp: meanFp(grp),
      critic_score: critics.length ? Math.max(...critics) : null,
      vintages,
    });
  }
  return out;
}
