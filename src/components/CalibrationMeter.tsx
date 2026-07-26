// Per-color palate calibration meter for the Palate profile.
// Derived purely from the viewer's own rating count per wine type — never
// from social metrics.
import { useMemo } from "react";
import { useRatings, useBottlesByIds, bottleType } from "@/hooks/use-palate-data";
import { calibrationPct, calibrationBand } from "@/lib/feed-reason";

function Row({ label, pct, band }: { label: string; pct: number; band: "thin" | "medium" | "strong" }) {
  const barClass = band === "strong"
    ? "bg-primary"
    : band === "medium"
    ? "bg-amber-500"
    : "bg-muted-foreground/50";
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 text-xs uppercase tracking-label text-muted-foreground">{label}</div>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${barClass} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-14 text-right text-xs tabular-nums text-foreground">
        {pct}% <span className="text-muted-foreground">cal.</span>
      </div>
    </div>
  );
}

export function CalibrationMeter() {
  const { data: ratings } = useRatings();
  const ids = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles } = useBottlesByIds(ids);

  const counts = useMemo(() => {
    const c: Record<"red" | "white", number> = { red: 0, white: 0 };
    for (const b of bottles ?? []) {
      const t = bottleType(b);
      if (t === "red" || t === "dessert") c.red += 1;
      else if (t === "white" || t === "sparkling" || t === "rose") c.white += 1;
    }
    return c;
  }, [bottles]);

  const redPct = calibrationPct(counts.red);
  const whitePct = calibrationPct(counts.white);

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="text-sm font-medium text-foreground">Palate calibration</div>
      <Row label="Red" pct={redPct} band={calibrationBand(redPct)} />
      <Row label="White" pct={whitePct} band={calibrationBand(whitePct)} />
      {(redPct < 40 || whitePct < 40) && (
        <p className="text-xs text-muted-foreground">
          Rate more of the light bars to sharpen your predictions.
        </p>
      )}
    </div>
  );
}
