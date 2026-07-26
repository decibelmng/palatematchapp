import { useRatings } from "@/hooks/use-palate-data";
import { ScanLine, Check } from "lucide-react";

export const UNLOCK_THRESHOLD = 5;

export function useRatingsCount(): number {
  const { data } = useRatings();
  return data?.length ?? 0;
}

export function UnlockMeter() {
  const count = useRatingsCount();
  const unlocked = count >= UNLOCK_THRESHOLD;
  const remaining = Math.max(0, UNLOCK_THRESHOLD - count);
  const pct = Math.min(100, (Math.min(count, UNLOCK_THRESHOLD) / UNLOCK_THRESHOLD) * 100);

  if (unlocked) {
    return (
      <div
        className="mt-4 rounded-xl border border-border/60 bg-muted/30 px-4 py-2.5 flex items-center gap-2 text-[12px] text-muted-foreground"
        aria-label={`${count} rated`}
      >
        <Check size={14} className="text-primary shrink-0" />
        <span>
          <span className="font-semibold text-foreground">{count}</span> rated — your palate keeps getting sharper.
        </span>
      </div>
    );
  }

  return (
    <div
      className="mt-4 rounded-xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-card p-4"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={UNLOCK_THRESHOLD}
      aria-valuenow={count}
      aria-label={`Rate ${UNLOCK_THRESHOLD} wines to unlock list recommendations`}
    >
      <div className="flex items-center gap-2">
        <ScanLine size={16} className="text-primary shrink-0" />
        <p className="text-[13px] font-semibold text-foreground">
          Rate {UNLOCK_THRESHOLD} wines to unlock list recommendations
        </p>
        <span className="ml-auto text-[12px] tabular-nums font-medium text-primary">
          {count}/{UNLOCK_THRESHOLD}
        </span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-border/70 overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {remaining === 1
          ? "One more to go — then I can rank any restaurant wine list for your taste."
          : `${remaining} more to go — then I can rank any restaurant wine list for your taste.`}
      </p>
    </div>
  );
}
