import { useEffect } from "react";
import type { PaletteType } from "@/lib/palate";

/** One-time celebratory reveal shown when the user crosses their 5th rating.
 *  Renders inline; caller controls dismissal via `onDismiss`. */
export function PalateReveal({
  code,
  type,
  onDismiss,
}: {
  code: string;
  type: PaletteType;
  onDismiss: () => void;
}) {
  useEffect(() => {
    // Auto-dismiss after 8s so it never blocks the UI.
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-6 mx-auto max-w-md rounded-[14px] border-[0.5px] border-primary/60 bg-[color-mix(in_oklab,var(--color-primary)_4%,var(--color-card))] p-5 text-center shadow-[var(--pm-card-shadow)]"
    >
      <p
        className="text-[10px] uppercase text-primary/80"
        style={{ letterSpacing: "0.22em" }}
      >
        Your {type} palate
      </p>
      <div
        className="mt-3 font-serif text-[34px] leading-none text-primary"
        style={{ letterSpacing: "0.3em" }}
      >
        {code.split("").map((ch, i) => (
          <span
            key={`reveal-${i}-${ch}`}
            className="pm-letter"
            style={{ ["--pm-delay" as string]: `${i * 90}ms` }}
          >
            {ch}
          </span>
        ))}
      </div>
      <p className="mt-4 font-serif italic text-[14px] text-foreground/90 leading-relaxed">
        You're on the map.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-4 text-[11px] uppercase text-muted-foreground hover:text-primary"
        style={{ letterSpacing: "0.18em" }}
      >
        Explore your palate →
      </button>
    </div>
  );
}
