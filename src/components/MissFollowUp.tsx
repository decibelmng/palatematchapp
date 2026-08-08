/** The one question we ask after a big miss.
 *
 *  When we said a wine would be a 4.5 and the person gave it a 3.5, that gap is
 *  the most useful signal in the app — but only if we know which half of the
 *  system was wrong. Two very different repairs hide behind the same number:
 *
 *    "Not the style I expected"   → the wine is described wrong in the catalog.
 *                                   The taste model reasoned correctly from bad
 *                                   data. Re-score the wine.
 *    "Right style, just not for me" → the description was fair and we still got
 *                                   it wrong. That's the taste model.
 *
 *  Deliberately one tap, inline, skippable, and never a modal — it appears
 *  after the rating is already saved and blocks nothing. It is asked once per
 *  rating, only when the gap is a full star or more, and never re-asked.
 *
 *  Mounted once in AppShell and driven by a tiny store, so every rating
 *  surface (cellar list, scan verdict, detail sheet) gets the same question
 *  without each screen re-implementing it.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/error-message";
import { toast } from "sonner";

export type MissPrompt = {
  outcomeId: string;
  /** Signed: rated minus expected. Negative = we oversold it. */
  delta: number;
  wineName: string;
};

/** A full star. Below this the gap is inside the model's own noise and asking
 *  would train the person to dismiss the question. */
export const MISS_PROMPT_THRESHOLD = 1.0;

type Listener = (p: MissPrompt | null) => void;
let current: MissPrompt | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(current);
}

/** Queue the question. Ignored unless the gap is a full star or more, so
 *  callers can hand over every rating without gating it themselves. */
export function askMissAttribution(p: MissPrompt) {
  if (!p.outcomeId || !Number.isFinite(p.delta)) return;
  if (Math.abs(p.delta) < MISS_PROMPT_THRESHOLD) return;
  current = p;
  emit();
}

export function dismissMissAttribution() {
  current = null;
  emit();
}

export function MissFollowUp() {
  const [prompt, setPrompt] = useState<MissPrompt | null>(current);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const l: Listener = (p) => setPrompt(p);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  if (!prompt) return null;

  const oversold = prompt.delta < 0;

  async function answer(attribution: "fingerprint" | "palate") {
    if (busy) return;
    setBusy(true);
    const { error } = await (supabase as any).rpc("set_miss_attribution", {
      p_outcome_id: prompt!.outcomeId,
      p_attribution: attribution,
    });
    setBusy(false);
    if (error) {
      toast.error(friendlyError(error, "Couldn't save that."));
      return;
    }
    dismissMissAttribution();
    toast.success("Noted — thank you.");
  }

  return (
    <div
      className="fixed inset-x-0 z-40 px-5"
      /* Sits above the bottom nav, not over the content the person is reading. */
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
    >
      <div className="pm-card max-w-xl mx-auto p-4">
        <p className="text-[length:var(--fs-body)] text-foreground">
          {oversold
            ? "We thought you'd like this more."
            : "You liked this more than we expected."}{" "}
          What was off with the {prompt.wineName}?
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => answer("fingerprint")}
            className="min-h-11 w-full rounded-lg border border-border px-4 text-left text-[length:var(--fs-body)] text-foreground disabled:opacity-60"
          >
            Not the style I expected
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => answer("palate")}
            className="min-h-11 w-full rounded-lg border border-border px-4 text-left text-[length:var(--fs-body)] text-foreground disabled:opacity-60"
          >
            Right style, just not for me
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={dismissMissAttribution}
            className="min-h-11 w-full text-[length:var(--fs-label)] text-muted-foreground"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
