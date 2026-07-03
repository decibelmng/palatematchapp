import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { AuthGate } from "@/components/AuthGate";
import { PalateStar } from "@/components/PalateStar";
import { useBottlesByIds, useRatings, bottleToValues, bottleType, usePersistCode } from "@/hooks/use-palate-data";
import { computeCode, describeCode, axesFor, type RatedBottle, type PaletteType } from "@/lib/palate";

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

function Home() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles } = useBottlesByIds(ratedIds);

  // Per-type rated-bottle pools. Each pool only contains bottles of that type,
  // and each bottle's `values` map is built using that type's axis set.
  const { redRated, whiteRated } = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const redRated: RatedBottle[] = [];
    const whiteRated: RatedBottle[] = [];
    for (const r of ratings ?? []) {
      const b = byId.get(r.bottle_id);
      if (!b) continue;
      const t = bottleType(b);
      if (t === "red") redRated.push({ stars: r.stars, values: bottleToValues(b, "red") });
      else if (t === "white") whiteRated.push({ stars: r.stars, values: bottleToValues(b, "white") });
    }
    return { redRated, whiteRated };
  }, [bottles, ratings]);

  const red = useMemo(() => computeCode(redRated, axesFor("red")), [redRated]);
  const white = useMemo(() => computeCode(whiteRated, axesFor("white")), [whiteRated]);

  usePersistCode(red.code, white.code, ratings?.length ?? 0);

  // Default the large star to whichever palate has more ratings (red on tie).
  const [scope, setScope] = useState<PaletteType>("red");
  useEffect(() => {
    if (whiteRated.length > redRated.length) setScope("white");
    else setScope("red");
  }, [redRated.length, whiteRated.length]);

  const active = scope === "red" ? red : white;
  const activeAxes = axesFor(scope);
  const activeRated = scope === "red" ? redRated : whiteRated;
  const resolved = active.letters.filter((l) => l.resolved).length;

  const totalRated = ratings?.length ?? 0;

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Your palates</p>

      {/* Two-code header */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <CodeChipRow type="red" code={red.code} axes={axesFor("red")} letters={red.letters} n={redRated.length} active={scope === "red"} onClick={() => setScope("red")} />
        <CodeChipRow type="white" code={white.code} axes={axesFor("white")} letters={white.letters} n={whiteRated.length} active={scope === "white"} onClick={() => setScope("white")} />
      </div>

      {/* Star visualization for the selected palate */}
      <div className="mt-6">
        <PalateStar axes={activeAxes} letters={active.letters} />
      </div>

      <p className="mt-4 text-sm text-foreground/90 leading-relaxed text-center">
        {activeRated.length === 0
          ? `Rate some ${scope === "red" ? "reds" : "whites"} to reveal your ${scope === "red" ? "red" : "white"} palate.`
          : describeCode(active.letters)}
      </p>
      <p className="mt-1 text-xs text-muted-foreground text-center">
        {resolved}/5 axes resolved · {activeRated.length} {scope === "red" ? "red" : "white"}{activeRated.length === 1 ? "" : "s"}
      </p>

      {totalRated === 0 && (
        <div className="mt-10 rounded-xl border border-border bg-card/60 p-5">
          <h2 className="font-serif text-lg">Start tasting.</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap stars on bottles you've actually tried. Your two palates resolve as you go — no descriptions, no quizzes.
          </p>
          <Link to="/rate" className="mt-4 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">
            Rate a bottle
          </Link>
        </div>
      )}

      {totalRated > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link to="/rate" className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent">
            Edit your ratings ({totalRated})
          </Link>
          <Link to="/rate" className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent">
            Rate more
          </Link>
          <Link to="/pour" className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90">
            Pour next →
          </Link>
        </div>
      )}

      {totalRated > 0 && <TopMatchesSection />}

      <div className="mt-10">
        <h3 className="font-serif text-base">What the letters mean</h3>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 text-xs text-muted-foreground">
          <div>
            <p className="text-foreground/80 mb-1">Reds</p>
            <ul className="space-y-1">
              {axesFor("red").map((a) => (
                <li key={a.key}><span className="text-foreground">{a.label}</span> · {a.low} {a.lowName} / {a.high} {a.highName}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-foreground/80 mb-1">Whites</p>
            <ul className="space-y-1">
              {axesFor("white").map((a) => (
                <li key={a.key}><span className="text-foreground">{a.label}</span> · {a.low} {a.lowName} / {a.high} {a.highName}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function CodeChipRow({
  type, code, n, active, onClick,
}: {
  type: PaletteType;
  code: string;
  axes: ReturnType<typeof axesFor>;
  letters: ReturnType<typeof computeCode>["letters"];
  n: number;
  active: boolean;
  onClick: () => void;
}) {
  const label = type === "red" ? "RED" : "WHITE";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition ${
        active ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:bg-accent"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">
          {n === 0 ? "no ratings yet" : n < 3 ? `still learning · ${n}` : `${n} rated`}
        </span>
      </div>
      <div className="mt-2 flex gap-1.5 font-serif text-2xl text-primary">
        {code.split("").map((ch, i) => (
          <span key={i} className={`w-6 text-center ${ch === "·" ? "text-muted-foreground/60" : ""}`}>{ch}</span>
        ))}
      </div>
    </button>
  );
}
