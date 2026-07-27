// Compact ranked list for stored scans. Always recomputes against the
// viewer's rated bottles — the ranking is never stored.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { recommend, type BottleFp, type RatedFp, type WineType } from "@/lib/recommender";
import type { StoredScanRow } from "@/lib/scans-history.functions";

type Props = {
  wines: StoredScanRow[];
  ratedRows: RatedFp[];
  emptyLabel?: string;
};

export function RankedScanList({ wines, ratedRows, emptyLabel = "No readable wines on this scan." }: Props) {
  const ranked = useMemo(() => {
    const readable = wines.filter((w) => w.fp);
    if (readable.length === 0) return [];
    const candidates: BottleFp[] = readable.map((w, i) => ({
      id: `s-${i}`,
      name: [w.producer, w.cuvee, w.vintage].filter(Boolean).join(" ") || "Unknown wine",
      producer: w.producer ?? null,
      region: w.region ?? null,
      type: ((w.wine_type as WineType) ?? "red"),
      fp: w.fp,
    }));
    const withMeta = readable.map((w, i) => ({ w, id: `s-${i}` }));
    if (ratedRows.length === 0) {
      // Can't rank yet — return unranked list.
      return withMeta.map((row) => ({
        w: row.w, id: row.id, predicted: 0, vetoed: false, contested: false,
      }));
    }
    const recs = recommend(ratedRows, candidates);
    const byId = new Map(withMeta.map((row) => [row.id, row.w]));
    return recs.map((r) => ({
      w: byId.get(r.bottle.id)!,
      id: r.bottle.id,
      predicted: r.predicted,
      vetoed: r.vetoed,
      contested: r.contested,
    }));
  }, [wines, ratedRows]);

  if (ranked.length === 0) {
    return <div className="text-sm text-muted-foreground py-6">{emptyLabel}</div>;
  }

  return (
    <ul className="space-y-2">
      {ranked.map((r) => {
        const label = [r.w.producer, r.w.cuvee, r.w.vintage].filter(Boolean).join(" ") || "Unknown wine";
        const meta = [
          r.w.wine_type, r.w.region, r.w.grape,
          r.w.format && r.w.format !== "bottle" ? r.w.format : null,
          r.w.price,
        ].filter(Boolean).join(" · ");
        const cls = r.vetoed
          ? "pm-vetoed-rail border-[color-mix(in_oklab,var(--crimson)_55%,transparent)] opacity-70"
          : r.contested
            ? "pm-contested-rail border-[color-mix(in_oklab,var(--amber)_55%,transparent)]"
            : r.predicted >= 4
              ? "border-primary/50"
              : "border-border";

        const content = (
          <div className={`flex items-center gap-3 rounded-lg border ${cls} bg-card p-3`}>
            <div className="w-11 text-center shrink-0">
              <div className="text-lg font-semibold tabular-nums">
                {r.predicted > 0 ? r.predicted.toFixed(1) : "—"}
              </div>
              <div className="text-meta uppercase tracking-label text-muted-foreground">stars</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                {r.vetoed && <span className="pm-skip-badge shrink-0 mt-0.5">Skip</span>}
                <div className="text-sm font-medium line-clamp-2 flex-1 min-w-0">{label}</div>
              </div>
              {meta && <div className="text-xs text-muted-foreground mt-0.5 truncate">{meta}</div>}
              {r.contested && !r.vetoed && <div className="text-meta uppercase tracking-label text-foreground mt-1">caution</div>}
            </div>

          </div>
        );
        return (
          <li key={r.id}>
            {r.w.matched_bottle_id
              ? <Link to="/wine/$id" params={{ id: r.w.matched_bottle_id }} className="block">{content}</Link>
              : content}
          </li>
        );
      })}
    </ul>
  );
}
