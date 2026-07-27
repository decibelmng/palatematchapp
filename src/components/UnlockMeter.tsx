import { Link } from "@tanstack/react-router";
import { useRatings } from "@/hooks/use-palate-data";
import { useCalibrationState } from "@/hooks/use-calibration";
import { Check, Sparkles, ArrowRight } from "lucide-react";

/** Legacy export kept so existing imports don't break — the semantic
 *  meaning is now "how many real ratings until the quiz seeds fade out".
 *  Prefer useCalibrationState() for gating logic. */
export const UNLOCK_THRESHOLD = 5;

export function useRatingsCount(): number {
  const { data } = useRatings();
  return data?.length ?? 0;
}

/** Calibration meter — no longer a hard gate. Points the user at the style
 *  quiz when they haven't finished it, or at rating when they have. */
export function UnlockMeter() {
  const { calibrated, provisional, realCount } = useCalibrationState();

  if (calibrated && !provisional) {
    return (
      <div
        className="mt-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 flex items-center gap-2 text-meta text-muted-foreground"
        aria-label={`${realCount} rated`}
      >
        <Check size={14} className="text-primary shrink-0" />
        <span>
          <span className="font-semibold text-foreground">{realCount}</span> rated — your palate keeps getting sharper.
        </span>
      </div>
    );
  }

  if (provisional) {
    return (
      <Link
        to="/rate"
        className="mt-4 block rounded-xl border border-primary/40 bg-primary/5 px-4 py-3"
        aria-label="Rate a few real bottles to sharpen predictions"
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-primary shrink-0" />
          <p className="text-meta font-semibold text-foreground">
            You're calibrated — provisional
          </p>
          <span className="ml-auto text-meta tabular-nums font-medium text-primary">
            {realCount}/{UNLOCK_THRESHOLD}
          </span>
        </div>
        <p className="mt-1.5 text-meta text-muted-foreground">
          Predictions sharpen every time you rate a real bottle. <span className="text-primary inline-flex items-center gap-0.5">Rate a wine <ArrowRight size={12} /></span>
        </p>
      </Link>
    );
  }

  // Not calibrated at all — point at the quiz, not at recall-based rating.
  return (
    <Link
      to="/onboarding"
      className="mt-4 block rounded-xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-card p-4"
      aria-label="Finish calibration to rank any wine list"
    >
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-primary shrink-0" />
        <p className="text-meta font-semibold text-foreground">
          Finish calibration to rank a wine list
        </p>
      </div>
      <p className="mt-2 text-meta text-muted-foreground">
        One minute of tapping — no wine names, no jargon. <span className="text-primary inline-flex items-center gap-0.5">Start <ArrowRight size={12} /></span>
      </p>
    </Link>
  );
}
