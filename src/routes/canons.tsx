import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Crown } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useMyCanons, useDemoteCanon, type CanonRow } from "@/hooks/use-canon";
import { useBottlesByIds, type BottleRow } from "@/hooks/use-palate-data";
import { CanonBadge } from "@/components/CanonBadge";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import type { WineType } from "@/lib/recommender";

export const Route = createFileRoute("/canons")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Canon Cellar — Palate Match" },
      { name: "description", content: "Your definitive benchmark wine for each region — the engine's true-north anchors." },
    ],
  }),
  component: () => <AuthGate><CanonsPage /></AuthGate>,
});

const TYPE_ORDER: WineType[] = ["red", "white", "sparkling", "rose", "dessert"];
const TYPE_LABEL: Record<string, string> = {
  red: "Red Canons",
  white: "White Canons",
  sparkling: "Sparkling Canons",
  rose: "Rosé Canons",
  dessert: "Dessert Canons",
};

function CanonsPage() {
  const { data: canons, isLoading } = useMyCanons();
  const bottleIds = useMemo(() => (canons ?? []).map((c) => c.bottle_id), [canons]);
  const { data: bottles } = useBottlesByIds(bottleIds);
  const demote = useDemoteCanon();

  const grouped = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const out: Record<string, { canon: CanonRow; bottle: BottleRow }[]> = {};
    for (const c of canons ?? []) {
      const b = byId.get(c.bottle_id);
      if (!b) continue;
      (out[c.wine_type] ??= []).push({ canon: c, bottle: b });
    }
    return out;
  }, [canons, bottles]);

  const totalCanons = canons?.length ?? 0;

  return (
    <div className="pt-2">
      <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>Canon Cellar</p>
      <h1 className="font-serif text-3xl mt-2 flex items-center gap-2">
        <Crown size={26} strokeWidth={2.2} fill="currentColor" className="text-amber-600" />
        Your true north
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The single benchmark wine you've crowned for each region &amp; type. The engine treats each as
        a definitive match — no averaging, one anchor per region.
      </p>

      {isLoading && totalCanons === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : totalCanons === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card/40 p-6 text-center">
          <Crown size={28} strokeWidth={2.2} className="mx-auto text-amber-600/60" />
          <p className="mt-3 font-serif text-lg">No Canons yet.</p>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            When a wine is <em>the one</em> for a region, crown it — the engine will use it as your
            true north.
          </p>
          <Link
            to="/rate"
            className="mt-5 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            Go rate wines
          </Link>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {TYPE_ORDER.flatMap((t) => {
            const rows = grouped[t] ?? [];
            if (rows.length === 0) return [];
            return [
              <section key={t}>
                <div className="flex items-baseline justify-between">
                  <h2 className="font-serif text-xl">{TYPE_LABEL[t]}</h2>
                  <span className="text-[11px] text-muted-foreground">{rows.length} region{rows.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="mt-3 divide-y divide-border">
                  {rows.map(({ canon, bottle }) => (
                    <li key={canon.id} className="py-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <CanonBadge />
                          <WineTypeBadge type={bottle.type} />
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{canon.region}</span>
                        </div>
                        <p className="mt-1 font-medium leading-tight truncate">{bottle.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[bottle.producer, bottle.vintage].filter(Boolean).join(" · ")}
                        </p>
                        {bottle.tasting_note && (
                          <p className="mt-1 text-[11px] italic text-muted-foreground line-clamp-2">"{bottle.tasting_note}"</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Remove Canon status from ${bottle.name}?`)) {
                            demote.mutate(canon.id);
                          }
                        }}
                        className="shrink-0 text-[11px] text-muted-foreground hover:text-destructive underline underline-offset-2"
                      >
                        remove
                      </button>
                    </li>
                  ))}
                </ul>
              </section>,
            ];
          })}
        </div>
      )}

      <div className="mt-10 flex flex-wrap gap-2">
        <Link to="/" className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent">
          ← Back to palate
        </Link>
        <Link to="/matches" className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent">
          See your matches
        </Link>
      </div>
    </div>
  );
}
