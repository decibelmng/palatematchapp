// Tappable palate code with per-letter meanings.
//
// The five-letter code is the product's central identity — the profile
// screen renders it as the hero. This component makes the notation teach
// itself: each letter is individually tappable and shows its one-line
// meaning ("B for bold", "S for silky"). On first view after the reveal,
// the component auto-cycles once through every letter — see `autoCycle`.
// Never a legend table.
//
// A "·" position can mean two different things:
//   - unresolved (not enough evidence yet) — disabled, muted
//   - bimodal (real information: user goes both ways on that axis) —
//     tappable, muted. The distinction comes from `letters[i].bimodal`.

import { useEffect, useMemo, useRef, useState } from "react";
import type { LetterResult, PaletteType } from "@/lib/palate";
import { explainLetter } from "@/lib/palate-code-letters";

type Props = {
  code: string;
  type: PaletteType;
  /** Optional letter results — used to tell bimodal "·" from unresolved "·". */
  letters?: LetterResult[];
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
  letters,
  autoCycle = false,
  cycleKey,
  size = "display",
  className,
}: Props) {
  const [active, setActive] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = cycleKey ?? `pm.reader.cycled.${type}.${code}`;

  const bimodalAt = useMemo(() => {
    const set = new Set<number>();
    (letters ?? []).forEach((l, i) => { if (l.bimodal) set.add(i); });
    return set;
  }, [letters]);

  const isDisabled = (i: number, ch: string) => ch === "·" && !bimodalAt.has(i);

  useEffect(() => {
    if (!autoCycle || typeof window === "undefined") return;
    try {
      if (window.localStorage.getItem(key) === "1") return;
      window.localStorage.setItem(key, "1");
    } catch { /* private mode etc. */ }

    // Cycle through resolved letters and bimodal positions — both carry meaning.
    const positions: number[] = [];
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (!ch) continue;
      if (ch !== "·" || bimodalAt.has(i)) positions.push(i);
    }
    if (positions.length === 0) return;

    let idx = 0;
    const tick = () => {
      setActive(positions[idx]);
      idx++;
      if (idx >= positions.length) {
        timer.current = setTimeout(() => setActive(null), AUTO_STEP_MS);
        return;
      }
      timer.current = setTimeout(tick, AUTO_STEP_MS);
    };
    tick();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [autoCycle, code, type, key, bimodalAt]);

  const meaning =
    active != null
      ? explainLetter(type, code, active, bimodalAt.has(active))
      : null;

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
          const disabled = isDisabled(i, ch);
          const muted = ch === "·";
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
                muted ? "text-muted-foreground" : "",
                disabled ? "cursor-default" : "hover:text-primary",
                isActive ? (muted ? "bg-muted/40 text-foreground" : "bg-primary/12 text-primary") : "",
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
