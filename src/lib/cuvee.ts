// Cuvée-level identity helpers. A "cuvée" is producer + label + region —
// vintages of the same wine collapse into one cuvée; different bottlings
// from the same producer (Barolo vs Barbaresco vs Bric Turot) do not.

import { RAX, hasAxis, type FpKey, type FpVec, type WineType } from "@/lib/recommender";

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
  fp: FpVec;
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
  fp: FpVec;
  critic_score: number | null;
  price_band: string | null;
  vintages: number[];    // sorted desc
  raw: boolean;          // true = every vintage in this cuvée is un-refingerprinted
};

type RatedInput = {
  id: string;
  name: string;
  producer?: string | null;
  region?: string | null;
  type: WineType;
  vintage?: number | null;
  fp: FpVec;
  stars: number;
};
type CandidateInput = {
  id: string;
  name: string;
  producer?: string | null;
  region?: string | null;
  type: WineType;
  vintage?: number | null;
  fp: FpVec;
  critic_score?: number | null;
  price_band?: string | null;
  raw?: boolean;
};

function meanFp(rows: { fp: FpVec }[]): FpVec {
  // Average over the rows that actually READ each axis. An axis no row read is
  // omitted, not zeroed: an unread dimension must not enter distance.
  const out: FpVec = {};
  for (const k of RAX) {
    let s = 0, n = 0;
    for (const r of rows) {
      if (!hasAxis(r.fp, k)) continue;
      s += r.fp[k] as number;
      n += 1;
    }
    if (n > 0) out[k] = s / n;
  }
  return out;
}

/**
 * Representative bottle for a cuvée.
 *
 * NON-VINTAGE IS A CATEGORY, NOT A GAP. Most Champagne, plenty of sherry and
 * port carry no vintage by design. Sorting a null vintage as -1 puts NV below
 * every dated bottle, so an NV wine loses the representative pick to any dated
 * sibling and the cuvée surface then shows — and matches against — the wrong
 * bottle.
 *
 * So NV is handled as its own case, never as a number on the vintage scale:
 *   - all rows NV  -> first NV row is the representative
 *   - mixed        -> the most recent DATED vintage, decided among dated rows
 *                     only; the NV rows never take part in that comparison
 *   - all dated    -> most recent, as before
 */
export function pickRep<T extends { vintage?: number | null; id: string }>(rows: T[]): T {
  const dated = rows.filter((r) => r.vintage != null);
  if (dated.length === 0) return rows[0];
  return [...dated].sort((a, b) => (b.vintage as number) - (a.vintage as number))[0];
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
      producer: rep.producer ?? null,
      region: rep.region ?? null,
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
      producer: rep.producer ?? null,
      region: rep.region ?? null,
      type: rep.type,
      fp: meanFp(grp),
      critic_score: critics.length ? Math.max(...critics) : null,
      price_band: rep.price_band ?? grp.find((g) => g.price_band)?.price_band ?? null,
      vintages,
      raw: grp.every((g) => g.raw !== false),
    });
  }
  return out;
}
