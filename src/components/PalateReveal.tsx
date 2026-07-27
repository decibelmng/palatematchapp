import { useEffect } from "react";
import type { PaletteType } from "@/lib/palate";
import { PalateCodeReader } from "@/components/PalateCodeReader";
import { archetypeFor, type QuizAnswers } from "@/lib/quiz-seeds";

/** Post-onboarding reveal. The palate code is the hero — it is the
 *  identity. The archetype name sits beneath as a secondary label, and
 *  the tagline is the caption. Auto-cycles through each letter once via
 *  PalateCodeReader (guarded by localStorage so it never plays twice). */
export function PalateReveal({
  code,
  type,
  answers,
  onDismiss,
}: {
  code: string;
  type: PaletteType;
  /** Optional — when present, drives archetype name + tagline. */
  answers?: QuizAnswers | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    // Auto-dismiss after a longer window so the intro cycle has time to run.
    const t = setTimeout(onDismiss, 14000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const arche = answers ? archetypeFor(answers, type) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-6 mx-auto max-w-md rounded-[14px] border border-primary/60 bg-[color-mix(in_oklab,var(--color-primary)_4%,var(--color-card))] p-5 text-center shadow-[var(--pm-card-shadow)]"
    >
      <p className="text-meta uppercase tracking-label text-primary/80">
        Your {type} palate has a code
      </p>

      <div className="mt-3 flex justify-center">
        <PalateCodeReader
          code={code}
          type={type}
          autoCycle
          size="display"
          className="max-w-full"
        />
      </div>

      {arche && (
        <>
          <div className="mt-4 font-serif text-heading leading-tight text-foreground">
            {arche.name}
          </div>
          <p className="mt-1 text-sub text-muted-foreground max-w-[36ch] mx-auto">
            {arche.tagline}
          </p>
        </>
      )}

      <button
        type="button"
        onClick={onDismiss}
        className="mt-5 text-meta uppercase tracking-label text-muted-foreground hover:text-primary"
      >
        Explore your palate →
      </button>
    </div>
  );
}
