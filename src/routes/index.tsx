import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { ScanText, Sparkles } from "lucide-react";

import { useOnboardingStage } from "@/hooks/use-onboarding";
import { OnboardingIntro } from "@/components/OnboardingIntro";
import { PalateReveal } from "@/components/PalateReveal";
import {
  useBottlesByIds,
  useRatings,
  bottleToValues,
  bottleType,
  usePersistCode,
} from "@/hooks/use-palate-data";
import { useMyCanons } from "@/hooks/use-canon";
import { computeCode, axesFor, type RatedBottle, type PaletteType } from "@/lib/palate";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Your Palate Code — Palate Match" },
      { name: "description", content: "Two palate codes — one for reds, one for whites — computed live from the bottles you've rated." },
    ],
  }),
  component: () => <AuthGate><Home /></AuthGate>,
});

const MIN_RATINGS = 5;

function Home() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles } = useBottlesByIds(ratedIds);
  const { data: canons } = useMyCanons();
  const canonBottleIds = useMemo(
    () => new Set((canons ?? []).filter((c) => c.tier === "canon").map((c) => c.bottle_id)),
    [canons],
  );

  const { redRated, whiteRated } = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const redRated: RatedBottle[] = [];
    const whiteRated: RatedBottle[] = [];
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b) continue;
      const t = bottleType(b);
      const canon = canonBottleIds.has(b.id);
      if (t === "red") redRated.push({ stars: r.stars, values: bottleToValues(b, "red"), canon });
      else if (t === "white") whiteRated.push({ stars: r.stars, values: bottleToValues(b, "white"), canon });
    }
    return { redRated, whiteRated };
  }, [bottles, ratings, canonBottleIds]);

  const red = useMemo(() => computeCode(redRated, axesFor("red")), [redRated]);
  const white = useMemo(() => computeCode(whiteRated, axesFor("white")), [whiteRated]);
  usePersistCode(red.code, white.code, ratings?.length ?? 0);

  const totalRated = ratings?.length ?? 0;
  const anyPalateReady = redRated.length >= MIN_RATINGS || whiteRated.length >= MIN_RATINGS;

  const { stage, isLoading: stageLoading, setStage } = useOnboardingStage();

  // Reveal fires once when the user first crosses the threshold, regardless of stage source.
  const [showReveal, setShowReveal] = useState(false);
  useEffect(() => {
    if (stageLoading) return;
    if (stage !== "done" && anyPalateReady) {
      setShowReveal(true);
      setStage("done").catch(() => { /* toast handled elsewhere */ });
    }
  }, [stage, stageLoading, anyPalateReady, setStage]);

  const revealScope: PaletteType = whiteRated.length > redRated.length ? "white" : "red";
  const revealCode = revealScope === "red" ? red.code : white.code;

  // Stage: intro (first-run welcome) — full-screen takeover
  if (!stageLoading && stage === "intro" && totalRated === 0) {
    return <OnboardingIntro onStart={() => { setStage("rate5").catch(() => { /* noop */ }); }} />;
  }

  // Stage: rate5 — minimal progress-focused surface, single CTA
  if (!stageLoading && stage === "rate5" && !anyPalateReady) {
    return (
      <div className="pt-6">
        <Rate5Progress redN={redRated.length} whiteN={whiteRated.length} />
      </div>
    );
  }

  // Stage: done — simplified home
  return (
    <div className="pt-2">
      {showReveal && (
        <PalateReveal code={revealCode} type={revealScope} onDismiss={() => setShowReveal(false)} />
      )}

      <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>
        Your palates
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CodeChipRow type="red" code={red.code} n={redRated.length} />
        <CodeChipRow type="white" code={white.code} n={whiteRated.length} />
      </div>

      {/* Primary CTA — scan a list */}
      <Link
        to="/scan"
        className="mt-6 flex items-center gap-3 rounded-[14px] border-[0.5px] border-primary bg-[color-mix(in_oklab,var(--color-primary)_6%,var(--color-card))] px-5 py-5 shadow-[var(--pm-card-shadow)] hover:bg-[color-mix(in_oklab,var(--color-primary)_10%,var(--color-card))] transition"
      >
        <ScanText size={22} className="text-primary shrink-0" strokeWidth={1.8} />
        <div className="flex-1">
          <div className="font-serif text-[17px] leading-tight">Scan a wine list</div>
          <div className="text-[12px] text-muted-foreground mt-0.5">See what to order — matched to your palate.</div>
        </div>
        <span className="text-primary text-lg" aria-hidden="true">→</span>
      </Link>

      {/* Secondary — see matches */}
      <Link
        to="/matches"
        className="mt-3 flex items-center gap-3 rounded-[14px] border-[0.5px] border-border bg-card px-4 py-3 hover:bg-accent transition shadow-[var(--pm-card-shadow)]"
      >
        <Sparkles size={16} className="text-muted-foreground shrink-0" strokeWidth={1.8} />
        <div className="flex-1 text-[13px]">See your matches</div>
        <span className="text-muted-foreground" aria-hidden="true">→</span>
      </Link>

      <div className="mt-6 flex items-center justify-center">
        <Link
          to="/rate"
          className="text-[11px] uppercase text-muted-foreground hover:text-primary"
          style={{ letterSpacing: "0.18em" }}
        >
          Rate more ({totalRated}) →
        </Link>
      </div>
    </div>
  );
}

function Rate5Progress({ redN, whiteN }: { redN: number; whiteN: number }) {
  const n = Math.max(redN, whiteN);
  const scope = whiteN > redN ? "whites" : "reds";
  const pct = Math.min(100, (n / MIN_RATINGS) * 100);
  return (
    <div className="text-center max-w-md mx-auto">
      <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>
        Getting started
      </p>
      <h2 className="mt-3 font-serif text-[22px] leading-snug">
        Rate {MIN_RATINGS} {scope} to place yourself on the map
      </h2>
      <p className="mt-2 text-xs text-muted-foreground">{n} of {MIN_RATINGS} rated</p>
      <div className="mx-auto mt-4 h-1 max-w-xs rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <Link
        to="/rate"
        className="mt-6 inline-block rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:opacity-90"
      >
        {n >= 1 ? "Keep rating" : "Rate your first wine"}
      </Link>
      <ol className="mt-8 grid gap-3 text-left">
        {[
          "Rate wines you know you love — or don't",
          "You appear on the map with a palate code",
          "Scan any wine list — we show your matches",
        ].map((text, i) => (
          <li key={i} className={`flex items-center gap-3 text-[13px] ${i === 0 ? "" : "opacity-60"}`}>
            <span className="w-5 h-5 rounded-full border border-border flex items-center justify-center text-[11px]">
              {i + 1}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CodeChipRow({ type, code, n }: { type: PaletteType; code: string; n: number }) {
  const label = type === "red" ? "RED" : "WHITE";
  return (
    <Link
      to="/palate/$type"
      params={{ type }}
      className="text-left rounded-[14px] border-[0.5px] border-border bg-card/60 p-4 transition shadow-[var(--pm-card-shadow)] hover:bg-accent hover:border-primary/40"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>{label}</span>
        <span className="text-[10px] text-muted-foreground">
          {n === 0 ? "no ratings yet" : n < 3 ? `still learning · ${n}` : `${n} rated`}
        </span>
      </div>
      <div className="mt-3 mb-1 font-serif text-[30px] text-primary leading-none" style={{ letterSpacing: "0.3em" }}>
        {code.split("").map((ch, i) => (
          <span
            key={`${type}-${i}-${ch}`}
            className={`pm-letter ${ch === "·" ? "text-muted-foreground/60" : ""}`}
            style={{ ["--pm-delay" as string]: `${i * 50}ms` }}
            title={ch === "X" ? "loves both poles" : undefined}
          >
            {ch}
          </span>
        ))}
      </div>
    </Link>
  );
}
