import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useBottlesByIds, useRatings, bottleToAx, usePersistCode } from "@/hooks/use-palate-data";
import { computeCode, describeCode } from "@/lib/palate";

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

function Home() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles } = useBottlesByIds(ratedIds);


  const { rated, code, letters, description, resolved } = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const rated = (ratings ?? [])
      .map((r) => {
        const b = byId.get(r.bottle_id);
        return b ? { stars: r.stars, ax: bottleToAx(b) } : null;
      })
      .filter(Boolean) as { stars: number; ax: ReturnType<typeof bottleToAx> }[];
    const { code, letters } = computeCode(rated);
    return {
      rated,
      code,
      letters,
      description: describeCode(letters),
      resolved: letters.filter((l) => l.resolved).length,
    };
  }, [bottles, ratings]);

  usePersistCode(code, rated.length);

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Your palate code</p>

      <div className="mt-4 flex justify-between gap-2 sm:gap-3">
        {letters.map((l) => (
          <div key={l.axis} className="flex flex-col items-center gap-2">
            <div className={`code-slot ${!l.resolved ? "code-slot-empty" : ""}`}>{l.letter}</div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{l.label}</span>
          </div>
        ))}
      </div>

      <p className="mt-6 text-sm text-foreground/90 leading-relaxed">{description}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {resolved}/5 axes resolved · {rated.length} bottle{rated.length === 1 ? "" : "s"} rated
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
