import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PaletteType } from "@/lib/palate";
import type { FpKey } from "@/lib/recommender";
import { bottleToFp, type BottleRow } from "./use-palate-data";
import { cuveeKey } from "@/lib/cuvee";

export type LandmarkDef = {
  label: string;
  sub: string;
  /** Pinned x — 0..1 (Light → Bold). */
  body: number;
  /** Pinned y — 0..1 (Fruit-forward → Earthy/Mineral). */
  earthy: number;
  /** Query used only to attempt bottle-id resolution. */
  q: string;
};

const LANDMARKS: Record<PaletteType, LandmarkDef[]> = {
  red: [
    { label: "Romanée-Conti",   sub: "DRC · Burgundy",    body: 0.48, earthy: 0.72, q: "Romanee-Conti Domaine de la Romanee-Conti" },
    { label: "Monfortino",      sub: "Conterno · Barolo", body: 0.85, earthy: 0.85, q: "Giacomo Conterno Monfortino Barolo" },
    { label: "Screaming Eagle", sub: "Napa",              body: 0.85, earthy: 0.28, q: "Screaming Eagle Cabernet" },
    { label: "Silver Oak",      sub: "Alexander Valley",  body: 0.78, earthy: 0.33, q: "Silver Oak Alexander Valley Cabernet" },
    { label: "Realm",           sub: "Napa",              body: 0.86, earthy: 0.22, q: "Realm Cellars Cabernet" },
    { label: "Fleurie",         sub: "Cru Beaujolais",    body: 0.30, earthy: 0.35, q: "Fleurie Beaujolais" },
    { label: "Château Margaux", sub: "Bordeaux",          body: 0.70, earthy: 0.60, q: "Chateau Margaux" },
  ],
  white: [
    { label: "Montrachet",         sub: "Burgundy",          body: 0.80, earthy: 0.65, q: "Montrachet Grand Cru" },
    { label: "Chablis",            sub: "Raveneau",          body: 0.45, earthy: 0.75, q: "Raveneau Chablis" },
    { label: "Kistler",            sub: "Sonoma Chardonnay", body: 0.80, earthy: 0.30, q: "Kistler Chardonnay" },
    { label: "Sancerre",           sub: "Loire",             body: 0.40, earthy: 0.55, q: "Sancerre" },
    { label: "Mosel Riesling",     sub: "Kabinett",          body: 0.25, earthy: 0.45, q: "Mosel Riesling Kabinett" },
    { label: "Corton-Charlemagne", sub: "Burgundy",          body: 0.75, earthy: 0.60, q: "Corton-Charlemagne" },
  ],
};

export type ResolvedLandmark = {
  label: string;
  sub: string;
  /** Pinned plot coordinates (0..1). Always present. */
  axBody: number;
  axFruit: number;
  /** Populated only if fuzzy lookup resolved a catalog bottle. */
  fp?: Record<FpKey, number>;
  bottleId?: string;
  cuveeKey?: string;
};

const STOPWORDS = new Set([
  "de", "la", "le", "les", "du", "des", "of", "the", "a", "an", "and",
  "et", "il", "el", "da", "di", "und", "y",
]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function normalize(s: string): string {
  return stripAccents(s.toLowerCase()).replace(/[^a-z0-9\s]/g, " ");
}
function tokens(s: string): string[] {
  return normalize(s).split(/\s+/).filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function pickBestHit(query: string, rows: BottleRow[]): BottleRow | null {
  const qTokens = tokens(query);
  if (qTokens.length === 0) return rows[0] ?? null;
  for (const row of rows) {
    const hay = tokens(`${row.producer ?? ""} ${row.name ?? ""}`);
    const overlap = qTokens.some((t) => hay.includes(t));
    if (overlap) return row;
  }
  return null;
}

export function useLandmarks(type: PaletteType) {
  return useQuery({
    queryKey: ["landmarks", type],
    staleTime: Infinity,
    queryFn: async (): Promise<ResolvedLandmark[]> => {
      const defs = LANDMARKS[type];
      return await Promise.all(
        defs.map(async (d): Promise<ResolvedLandmark> => {
          const base: ResolvedLandmark = {
            label: d.label,
            sub: d.sub,
            axBody: d.body,
            axFruit: d.earthy,
          };
          try {
            const { data, error } = await supabase.rpc("search_bottles_fuzzy", {
              q: stripAccents(d.q),
              type_variants: [type],
              lim: 5,
              threshold: 0.25,
            });
            if (error) return base;
            const rows = (data as BottleRow[] | null) ?? [];
            const row = rows.length ? pickBestHit(stripAccents(d.q), rows) : null;
            if (!row) return base;
            return {
              ...base,
              fp: bottleToFp(row),
              bottleId: row.id,
              cuveeKey: cuveeKey(row),
            };
          } catch {
            return base;
          }
        })
      );
    },
  });
}
