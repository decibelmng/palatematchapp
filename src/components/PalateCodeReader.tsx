// Tappable palate code with per-letter meanings.
//
// The five-letter code is the product's central identity — the profile
// screen renders it as the hero. This component makes the notation teach
// itself: each letter is individually tappable and shows its one-line
// meaning ("B for bold", "S for silky"). On first view after the reveal,
// the component auto-cycles once through every letter — see `autoCycle`.
// Never a legend table.

import { useEffect, useRef, useState } from "react";
import type { PaletteType } from "@/lib/palate";
import { explainLetter } from "@/lib/palate-code-letters";

type Props = {
  code: string;
  type: PaletteType;
  /** Play the intro cycle once, then never again unless a letter is tapped. */
  autoCycle?: boolean;
  /** Storage key for remembering that the intro has played. Default per type. */
  cycleKey?: string;
  /** Type-scale token for the code face. Defaults to `text-display`. */
  size?: "display" | "title" | "heading";
  className?: string;
};

const AUTO_STEP_MS = 1200;

export function PalateCodeReader({
  code,
  type,
  autoCycle = false,
  cycleKey,
  size = "display",
  className,
}: Props) {
  const [active, setActive] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = cycleKey ?? `pm.reader.cycled.${type}.${code}`;

  useEffect(() => {
    if (!autoCycle || typeof window === "undefined") return;
    // Guard: never run the auto-cycle twice for the same code/type.
    try {
      if (window.localStorage.getItem(key) === "1") return;
      window.localStorage.setItem(key, "1");
    } catch { /* private mode etc. — fall through and cycle anyway */ }

    // Skip empty positions ("·"). Cycle only through resolved letters so the
    // intro tells a coherent story, not "not yet resolved" five times.
    const positions: number[] = [];
    for (let i = 0; i < code.length; i++) if (code[i] && code[i] !== "·") positions.push(i);
    if (positions.length === 0) return;

    let idx = 0;
    const tick = () => {
      setActive(positions[idx]);
      idx++;
      if (idx >= positions.length) {
        // Hold the last letter briefly, then release the highlight so the
        // profile card returns to its resting state.
        timer.current = setTimeout(() => setActive(null), AUTO_STEP_MS);
        return;
      }
      timer.current = setTimeout(tick, AUTO_STEP_MS);
    };
    tick();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [autoCycle, code, type, key]);

  const meaning = active != null ? explainLetter(type, code, active) : null;

  const faceClass =
    size === "display" ? "text-display" : size === "title" ? "text-title" : "text-heading";

  return (
    <div className={className}>
      <div
        role="group"
        aria-label={`Palate code ${code}. Tap each letter for its meaning.`}
        className={`font-serif ${faceClass} leading-none tracking-[0.18em] text-primary`}
      >
        {code.split("").map((ch, i) => {
          const isActive = active === i;
          const disabled = ch === "·";
          return (
            <button
              key={`code-${i}-${ch}`}
              type="button"
              disabled={disabled}
              onClick={() => setActive(active === i ? null : i)}
              aria-pressed={isActive}
              aria-label={`Letter ${i + 1}: ${ch}`}
              className={[
                "inline-block px-1 min-w-[1ch] rounded-sm transition",
                disabled ? "text-muted-foreground/60 cursor-default" : "hover:text-primary",
                isActive ? "bg-primary/12 text-primary" : "",
              ].join(" ")}
              style={{ transitionDuration: "180ms" }}
            >
              {ch}
            </button>
          );
        })}
      </div>
      <div
        aria-live="polite"
        className="mt-3 min-h-[2.75rem] text-sub text-foreground/90 leading-snug"
      >
        {meaning ? (
          <>
            <span className="font-serif text-primary mr-1">{meaning.letter}</span>
            <span>{meaning.meaning}</span>
          </>
        ) : (
          <span className="text-meta text-muted-foreground">
            Tap a letter to see what it means.
          </span>
        )}
      </div>
    </div>
  );
}
