import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { PalateStar } from "@/components/PalateStar";
import { useBottlesByIds, useRatings, bottleToAx, bottleType, usePersistCode } from "@/hooks/use-palate-data";
import { computeCode, describeCode, type RatedBottle } from "@/lib/palate";
import type { WineType } from "@/lib/recommender";


export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Your Palate Code — Palate Match" },
      { name: "description", content: "Your 5-letter palate code, computed live from the bottles you've rated." },
    ],
  }),
  component: () => <AuthGate><Home /></AuthGate>,
});

type Scope = "all" | "red" | "white";

function Home() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles } = useBottlesByIds(ratedIds);
  const [scope, setScope] = useState<Scope>("all");

  const allRated = useMemo<RatedBottle[]>(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    return ((ratings ?? [])
      .map((r) => {
        const b = byId.get(r.bottle_id);
        return b ? { stars: r.stars, type: bottleType(b), ax: bottleToAx(b) } : null;
      })
      .filter(Boolean) as RatedBottle[]);
  }, [bottles, ratings]);

  const scopedRated = useMemo(() => {
    if (scope === "all") return allRated;
    const t: WineType = scope;
    return allRated.filter((r) => r.type === t);
  }, [allRated, scope]);

  const { code, letters, description, resolved } = useMemo(() => {
    const { code, letters } = computeCode(scopedRated);
    return {
      code,
      letters,
      description: describeCode(letters),
      resolved: letters.filter((l) => l.resolved).length,
    };
  }, [scopedRated]);

  // Persist the canonical (all-bottles) code, not the scoped view.
  const { code: canonicalCode } = useMemo(() => computeCode(allRated), [allRated]);
  usePersistCode(canonicalCode, allRated.length);

  const rated = scopedRated;
  const nReds = allRated.filter((r) => r.type === "red").length;
  const nWhites = allRated.filter((r) => r.type === "white").length;

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Your palate</p>

      {/* Star visualization */}
      <div className="mt-3">
        <PalateStar letters={letters} />
      </div>

      {/* Scope toggle */}
      <div className="mt-2 flex justify-center gap-1 text-xs">
        {([
          { id: "all", label: `All (${allRated.length})` },
          { id: "red", label: `Reds (${nReds})` },
          { id: "white", label: `Whites (${nWhites})` },
        ] as { id: Scope; label: string }[]).map((opt) => {
          const active = scope === opt.id;
          const disabled = opt.id !== "all" && (opt.id === "red" ? nReds === 0 : nWhites === 0);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => setScope(opt.id)}
              className={`rounded-full px-3 py-1 border transition ${
                active
                  ? "border-primary text-primary bg-primary/10"
                  : "border-border text-muted-foreground hover:bg-accent"
              } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex justify-between gap-2 sm:gap-3">
        {letters.map((l) => (
          <div key={l.axis} className="flex flex-col items-center gap-2">
            <div className={`code-slot ${!l.resolved ? "code-slot-empty" : ""}`}>{l.letter}</div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{l.label}</span>
          </div>
        ))}
      </div>

      <p className="mt-6 text-sm text-foreground/90 leading-relaxed">{description}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {resolved}/5 axes resolved · {rated.length} bottle{rated.length === 1 ? "" : "s"} in view
        {scope !== "all" && allRated.length !== rated.length ? ` · code ${code}` : ""}
      </p>



      {rated.length === 0 && (
        <div className="mt-10 rounded-xl border border-border bg-card/60 p-5">
          <h2 className="font-serif text-lg">Start tasting.</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tap stars on bottles you've actually tried. Your code resolves as you go — no descriptions, no quizzes.
          </p>
          <Link to="/rate" className="mt-4 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">
            Rate a bottle
          </Link>
        </div>
      )}

      {rated.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            to="/my-ratings"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Edit your ratings ({rated.length})
          </Link>
          <Link
            to="/rate"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            Rate more
          </Link>
        </div>
      )}

      {rated.length > 0 && rated.length < 5 && (
        <p className="mt-4 text-xs text-muted-foreground italic">
          Rate a few more — and try rating wines you <em>disliked</em> too, so we learn your limits.
        </p>
      )}

      <div className="mt-10">
        <h3 className="font-serif text-base">What the letters mean</h3>
        <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
          <li><span className="text-foreground">Body</span> · L light / B bold / N balanced</li>
          <li><span className="text-foreground">Fruit</span> · F fruit-forward / E earthy / N balanced</li>
          <li><span className="text-foreground">Tannin</span> · S silky / G grippy / N balanced</li>
          <li><span className="text-foreground">Acidity</span> · R round / C crisp / N balanced</li>
          <li><span className="text-foreground">Sweet</span> · D dry / W sweet</li>
        </ul>
      </div>
    </div>
  );
}
