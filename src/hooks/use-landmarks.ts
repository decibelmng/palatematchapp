import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PaletteType } from "@/lib/palate";
import type { FpKey } from "@/lib/recommender";
import { bottleToFp, type BottleRow } from "./use-palate-data";
import { cuveeKey } from "@/lib/cuvee";

export type LandmarkDef = { label: string; sub: string; q: string };

const LANDMARKS: Record<PaletteType, LandmarkDef[]> = {
  red: [
    { label: "Romanée-Conti", sub: "DRC · Burgundy", q: "Romanee-Conti Domaine de la Romanee-Conti" },
    { label: "Monfortino", sub: "Conterno · Barolo", q: "Giacomo Conterno Monfortino Barolo" },
    { label: "Screaming Eagle", sub: "Napa", q: "Screaming Eagle Cabernet" },
    { label: "Silver Oak", sub: "Alexander Valley", q: "Silver Oak Alexander Valley Cabernet" },
    { label: "Realm", sub: "Napa", q: "Realm Cellars Cabernet" },
    { label: "Fleurie", sub: "Cru Beaujolais", q: "Fleurie Beaujolais" },
    { label: "Château Margaux", sub: "Bordeaux", q: "Chateau Margaux" },
  ],
  white: [
    { label: "Montrachet", sub: "Burgundy", q: "Montrachet Grand Cru" },
    { label: "Chablis", sub: "Raveneau", q: "Raveneau Chablis" },
    { label: "Kistler", sub: "Sonoma Chardonnay", q: "Kistler Chardonnay" },
    { label: "Sancerre", sub: "Loire", q: "Sancerre" },
    { label: "Mosel Riesling", sub: "Kabinett", q: "Mosel Riesling Kabinett" },
    { label: "Corton-Charlemagne", sub: "Burgundy", q: "Corton-Charlemagne" },
  ],
};

export type ResolvedLandmark = {
  label: string;
  sub: string;
  fp: Record<FpKey, number>;
  axBody: number;
  axFruit: number;
  bottleId: string;
  cuveeKey: string;
  debug: {
    query: string;
    matchedName: string;
    matchedProducer: string | null;
    fp: Record<FpKey, number>;
    axBody: number;
    axFruit: number;
  };
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
      const results = await Promise.all(
        defs.map(async (d) => {
          const qStripped = stripAccents(d.q);
          const { data, error } = await supabase.rpc("search_bottles_fuzzy", {
            q: qStripped,
            type_variants: [type],
            lim: 5,
            threshold: 0.25,
          });
          if (error) return null;
          const rows = (data as BottleRow[] | null) ?? [];
          if (rows.length === 0) {
            console.warn(`[landmarks] no hits for "${d.q}"`);
            return null;
          }
          const row = pickBestHit(qStripped, rows);
          if (!row) {
            console.warn(
              `[landmarks] no producer-token match for "${d.q}"; candidates:`,
              rows.map((r) => `${r.producer ?? "?"} — ${r.name}`)
            );
            return null;
          }
          const fp = bottleToFp(row);
          return {
            label: d.label,
            sub: d.sub,
            fp,
            bottleId: row.id,
            cuveeKey: cuveeKey(row),
            debug: {
              query: d.q,
              matchedName: row.name,
              matchedProducer: row.producer,
              fp,
            },
          } as ResolvedLandmark;
        })
      );
      return results.filter((r): r is ResolvedLandmark => r !== null);
    },
  });
}
