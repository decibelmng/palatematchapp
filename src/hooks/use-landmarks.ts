import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PaletteType } from "@/lib/palate";
import type { FpKey } from "@/lib/recommender";
import { bottleToFp, type BottleRow } from "./use-palate-data";

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
};

export function useLandmarks(type: PaletteType) {
  return useQuery({
    queryKey: ["landmarks", type],
    staleTime: Infinity,
    queryFn: async (): Promise<ResolvedLandmark[]> => {
      const defs = LANDMARKS[type];
      const results = await Promise.all(
        defs.map(async (d) => {
          const { data, error } = await supabase.rpc("search_bottles_fuzzy", {
            q: d.q,
            type_variants: [type],
            lim: 1,
            threshold: 0.25,
          });
          if (error) return null;
          const row = (data as BottleRow[] | null)?.[0];
          if (!row) return null;
          return { label: d.label, sub: d.sub, fp: bottleToFp(row) } as ResolvedLandmark;
        })
      );
      return results.filter((r): r is ResolvedLandmark => r !== null);
    },
  });
}
