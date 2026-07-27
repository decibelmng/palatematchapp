import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { pairsFor, archetypeFor, type QuizAnswers, type QuizVote, type QuizPair } from "@/lib/quiz-seeds";
import { useSaveQuizAnswers, useQuizAnswers } from "@/hooks/use-quiz";
import type { PaletteType } from "@/lib/palate";
import { ArrowRight, Check, ScanLine } from "lucide-react";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Find your palate — Palate Match" },
      { name: "description", content: "A one-minute style quiz — no wine knowledge needed. Tap what you like." },
      { property: "og:title", content: "Find your palate — Palate Match" },
      { property: "og:description", content: "A one-minute style quiz — no wine knowledge needed. Tap what you like." },
    ],
  }),
  component: () => <AuthGate><Onboarding /></AuthGate>,
});

type Step = "type" | "pairs" | "reveal";

function Onboarding() {
  const nav = useNavigate();
  const { data: existing } = useQuizAnswers();
  const save = useSaveQuizAnswers();

  const [step, setStep] = useState<Step>(existing?.completedAt ? "reveal" : "type");
  const [type, setType] = useState<PaletteType | "both">(existing?.type ?? "red");
  const [votes, setVotes] = useState<Record<string, QuizVote>>(existing?.votes ?? {});
  const [pairIdx, setPairIdx] = useState(0);

  const allPairs = useMemo<QuizPair[]>(() => {
    if (type === "red") return pairsFor("red");
    if (type === "white") return pairsFor("white");
    return [...pairsFor("red"), ...pairsFor("white")];
  }, [type]);

  const total = allPairs.length;
  const current = allPairs[pairIdx];

  function record(vote: QuizVote) {
    if (!current) return;
    const next = { ...votes, [current.id]: vote };
    setVotes(next);
    if (pairIdx + 1 >= total) {
      // Finish → persist and jump to reveal.
      const answers: QuizAnswers = { type, votes: next };
      save.mutate(answers, {
        onSuccess: () => setStep("reveal"),
      });
    } else {
      setPairIdx((i) => i + 1);
    }
  }

  if (step === "type") {
    return (
      <div className="pt-4 pb-10 px-2">
        <p className="text-meta uppercase tracking-label text-muted-foreground">Step 1 of 3</p>
        <h1 className="mt-2 font-serif text-heading leading-tight">
          Red, white, or both?
        </h1>
        <p className="mt-2 text-sub text-muted-foreground max-w-[36ch]">
          Pick what you drink. We'll ask a few taste questions — no wine names, no jargon.
        </p>
        <div className="mt-6 grid gap-3">
          {(["red", "white", "both"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setType(t); setStep("pairs"); setPairIdx(0); }}
              className="pm-card p-4 text-left flex items-center gap-3 min-h-[64px] hover:border-primary transition"
            >
              <span className="font-serif text-heading capitalize flex-1">{t === "both" ? "Both" : t}</span>
              <ArrowRight className="text-primary" size={18} />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (step === "pairs" && current) {
    const pct = Math.round(((pairIdx) / total) * 100);
    return (
      <div className="pt-4 pb-10 px-2">
        <div className="flex items-center gap-3">
          <p className="text-meta uppercase tracking-label text-muted-foreground">
            Step 2 of 3 · {pairIdx + 1} / {total}
          </p>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-border/70 overflow-hidden">
          <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>

        <h2 className="mt-6 font-serif text-heading leading-tight">
          Which sounds better to you?
        </h2>

        <div className="mt-5 grid gap-3">
          <TapChoice label={current.high} onSelect={() => record(1)} />
          <TapChoice label={current.low} onSelect={() => record(-1)} />
          <button
            type="button"
            onClick={() => record(0)}
            className="mt-1 min-h-11 rounded-md text-sub text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            No preference
          </button>
        </div>

        <div className="mt-6 flex items-center justify-between text-meta text-muted-foreground">
          <button
            type="button"
            disabled={pairIdx === 0}
            onClick={() => setPairIdx((i) => Math.max(0, i - 1))}
            className="min-h-11 px-2 disabled:opacity-30"
          >
            ← Back
          </button>
          <span className="tabular-nums">{pairIdx + 1}/{total}</span>
        </div>
      </div>
    );
  }

  // Reveal
  const answers: QuizAnswers = existing?.completedAt
    ? existing
    : { type, votes, completedAt: new Date().toISOString() };
  // Prefer the primary type for the reveal (red > white when "both").
  const revealType: PaletteType = answers.type === "white" ? "white" : "red";
  const arche = archetypeFor(answers, revealType);

  return (
    <div className="pt-6 pb-10 px-2 text-center">
      <p className="text-meta uppercase tracking-label text-muted-foreground">Your archetype</p>
      <h1 className="mt-3 font-serif text-display leading-tight">{arche.name}</h1>
      <p className="mt-3 text-sub text-muted-foreground max-w-[34ch] mx-auto">
        {arche.tagline}
      </p>

      <p className="mt-5 text-meta text-muted-foreground">
        Your code · <span className="font-mono tracking-wider text-foreground">{arche.code}</span>
      </p>

      <button
        type="button"
        onClick={() => nav({ to: "/scan/list" })}
        className="mt-8 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-6 py-3 text-body font-medium hover:opacity-90 min-h-11"
      >
        <ScanLine size={18} /> Scan a wine list
      </button>

      <p className="mt-6 text-meta text-muted-foreground">
        Predictions sharpen every time you rate a real bottle.
      </p>

      <div className="mt-6 flex items-center justify-center gap-4 text-meta">
        <Link to="/rate" className="text-primary underline underline-offset-2">Rate a wine</Link>
        <span className="text-muted-foreground">·</span>
        <Link to="/palate" className="text-muted-foreground underline underline-offset-2">See your profile</Link>
      </div>
    </div>
  );
}

function TapChoice({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="pm-card w-full text-left px-4 py-4 min-h-[72px] flex items-center gap-3 hover:border-primary transition active:scale-[0.99]"
    >
      <span className="flex-1 font-serif text-heading leading-tight">{label}</span>
      <Check className="opacity-0 group-hover:opacity-100 text-primary" size={18} />
    </button>
  );
}
