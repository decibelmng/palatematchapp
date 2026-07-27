import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useSommelierBrief } from "@/hooks/use-sommelier-brief";
import { useMyProfile } from "@/hooks/use-friends";
import { archetypeFor, type QuizAnswers } from "@/lib/quiz-seeds";
import { ChevronLeft, Lock, Unlock } from "lucide-react";

export const Route = createFileRoute("/brief")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "For your sommelier — Palate Match" },
      { name: "description", content: "Hand your phone to your sommelier. Full-screen, high-contrast palate brief." },
    ],
  }),
  component: () => <AuthGate><BriefFullScreen /></AuthGate>,
});

/**
 * Full-screen palate brief in service theme (true black, 7:1 contrast, 17px+
 * body text, landscape-friendly). Tap the lock to disable the back gesture
 * while the phone changes hands.
 */
function BriefFullScreen() {
  const brief = useSommelierBrief();
  const { data: profile } = useMyProfile();
  const [locked, setLocked] = useState(false);

  const quiz = ((profile as any)?.quiz_answers ?? null) as QuizAnswers | null;
  const archetype = quiz && "votes" in quiz ? archetypeFor(quiz, quiz.type === "white" ? "white" : "red").name : null;

  useEffect(() => {
    if (!locked) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") e.preventDefault(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked]);

  if (!brief.text) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <p className="text-lg">Rate a few wines first — your brief needs something to say.</p>
          <Link to="/rate" className="mt-6 inline-flex rounded-full bg-white text-black px-4 py-2 text-base">
            Go to Rate
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      data-theme="service"
      className="fixed inset-0 z-[100] bg-black text-white overflow-y-auto"
      style={{ colorScheme: "dark" }}
    >
      <div className="mx-auto max-w-3xl px-6 pt-6 pb-24">
        <div className="flex items-center justify-between">
          {locked ? (
            <span className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-white/60">
              <Lock className="h-3 w-3" /> Locked — long-press to release
            </span>
          ) : (
            <Link to="/palate" className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-white/60 hover:text-white">
              <ChevronLeft className="h-3 w-3" /> Back
            </Link>
          )}
          <button
            type="button"
            aria-label={locked ? "Long-press to unlock" : "Hand to your sommelier"}
            onPointerDown={(e) => {
              if (!locked) { setLocked(true); return; }
              const start = Date.now();
              const target = e.currentTarget;
              const clear = () => target.removeEventListener("pointerup", up);
              const up = () => { if (Date.now() - start >= 900) setLocked(false); clear(); };
              target.addEventListener("pointerup", up, { once: true });
            }}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs uppercase tracking-wide ${locked ? "bg-white/10 text-white/70" : "bg-white text-black"}`}
          >
            {locked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            {locked ? "Long-press to release" : "Hand to your sommelier"}
          </button>
        </div>

        <p className="mt-8 text-[17px] leading-[1.7] font-serif whitespace-pre-wrap text-white">
          {brief.text}
        </p>

        {locked && (
          <div className="fixed inset-x-0 bottom-0 p-4 text-center text-xs uppercase tracking-wide text-white/50">
            Screen locked · Long-press the button to release
          </div>
        )}
      </div>
    </div>
  );
}
