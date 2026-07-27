// Actionable calibration hint. No percentages — a percentage is a fact about
// the model, not about the person. One sentence, tells you exactly what to
// do next, or nothing.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useRatings, useBottlesByIds, bottleType } from "@/hooks/use-palate-data";
import { Sparkles, ArrowRight } from "lucide-react";

// Below this per-type count, predictions for that color are still coarse.
// Matches the "provisional" heuristic used elsewhere in the app.
const TARGET_PER_TYPE = 8;

export function CalibrationMeter() {
  const { data: ratings } = useRatings();
  const ids = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles } = useBottlesByIds(ids);

  const { red, white } = useMemo(() => {
    const c = { red: 0, white: 0 };
    for (const b of bottles ?? []) {
      const t = bottleType(b);
      if (t === "red" || t === "dessert") c.red += 1;
      else if (t === "white" || t === "sparkling" || t === "rose") c.white += 1;
    }
    return c;
  }, [bottles]);

  // Pick whichever color needs the most help. If both are already at target,
  // render nothing — the whole card disappears.
  const redGap = Math.max(0, TARGET_PER_TYPE - red);
  const whiteGap = Math.max(0, TARGET_PER_TYPE - white);
  if (redGap === 0 && whiteGap === 0) return null;

  const worse: "red" | "white" = whiteGap > redGap ? "white" : "red";
  const gap = worse === "white" ? whiteGap : redGap;
  const noun = worse === "white" ? "white" : "red";
  const plural = gap === 1 ? "" : "s";
  const picks = worse === "white" ? "white picks" : "red picks";

  return (
    <Link
      to="/rate"
      className="flex items-center gap-3 rounded-[14px] border border-primary/30 bg-primary/5 p-3 hover:border-primary/60 transition"
    >
      <Sparkles size={16} className="text-primary shrink-0" />
      <p className="flex-1 text-meta text-foreground">
        Rate {gap} more {noun}{plural} to sharpen your {picks}.
      </p>
      <ArrowRight size={14} className="text-primary shrink-0" />
    </Link>
  );
}
