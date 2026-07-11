import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Crown, Skull } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useMyCanons, useDemoteCanon, type CanonRow } from "@/hooks/use-canon";
import { useBottlesByIds, type BottleRow } from "@/hooks/use-palate-data";
import { BenchmarkTierBadge } from "@/components/BenchmarkTierBadge";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import type { WineType } from "@/lib/recommender";

export const Route = createFileRoute("/canons")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Canon Cellar — Palate Match" },
      { name: "description", content: "Your benchmark wines: definitive loves (Canon) and dealbreakers (Nemesis) — the engine's true-north and never-again anchors." },
    ],
  }),
  component: () => <AuthGate><CanonsPage /></AuthGate>,
});

const TYPE_ORDER: WineType[] = ["red", "white", "sparkling", "rose", "dessert"];
const CANON_TYPE_LABEL: Record<string, string> = {
  red: "Red Canons",
  white: "White Canons",
  sparkling: "Sparkling Canons",
  rose: "Rosé Canons",
  dessert: "Dessert Canons",
};
const NEMESIS_TYPE_LABEL: Record<string, string> = {
  red: "Red Nemeses",
  white: "White Nemeses",
  sparkling: "Sparkling Nemeses",
  rose: "Rosé Nemeses",
  dessert: "Dessert Nemeses",
};

type Row = { canon: CanonRow; bottle: BottleRow };

function CanonsPage() {
  const { data: canons, isLoading } = useMyCanons();
  const bottleIds = useMemo(() => (canons ?? []).map((c) => c.bottle_id), [canons]);
  const { data: bottles } = useBottlesByIds(bottleIds);
  const demote = useDemoteCanon();

  const { canonGrouped, nemesisGrouped, totalCanons, totalNemeses } = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const canonOut: Record<string, Row[]> = {};
    const nemesisOut: Record<string, Row[]> = {};
    let nC = 0, nN = 0;
    for (const c of canons ?? []) {
      const b = byId.get(c.bottle_id);
      if (!b) continue;
      if (c.tier === "nemesis") {
        (nemesisOut[c.wine_type] ??= []).push({ canon: c, bottle: b });
        nN++;
      } else if (c.tier === "canon") {
        (canonOut[c.wine_type] ??= []).push({ canon: c, bottle: b });
        nC++;
      }
    }
    return { canonGrouped: canonOut, nemesisGrouped: nemesisOut, totalCanons: nC, totalNemeses: nN };
  }, [canons, bottles]);

  const totalAll = (canons?.length ?? 0);

  return (
    <div className="pt-2">
      <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>Canon Cellar</p>
      <h1 className="font-serif text-3xl mt-2 flex items-center gap-2">
        <Crown size={26} strokeWidth={2.2} fill="currentColor" className="text-amber-600" />
        Your true north
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Benchmark wines you've crowned for each region &amp; type. Canons anchor your matches;
        Nemeses steer the engine away from styles you don't want to see again.
      </p>

      {isLoading && totalAll === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Loading…</p>
      ) : totalAll === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border bg-card/40 p-6 text-center">
          <Crown size={28} strokeWidth={2.2} className="mx-auto text-amber-600/60" />
          <p className="mt-3 font-serif text-lg">No benchmarks yet.</p>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            When a wine is <em>the one</em> for a region, crown it — or mark a 1–2★ bottle as your
            Nemesis so the engine steers around it.
          </p>
          <Link
            to="/rate"
            className="mt-5 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            Go rate wines
          </Link>
        </div>
      ) : (
        <>
          {totalCanons > 0 && (
            <div className="mt-8 space-y-10">
              {TYPE_ORDER.flatMap((t) => {
                const rows = canonGrouped[t] ?? [];
                if (rows.length === 0) return [];
                return [
                  <TierSection
                    key={`canon-${t}`}
                    type={t}
                    tier="canon"
                    label={CANON_TYPE_LABEL[t]}
                    rows={rows}
                    onDemote={(id) => demote.mutate(id)}
                  />,
                ];
              })}
            </div>
          )}

          {totalNemeses > 0 && (
            <div className="mt-14">
              <div className="flex items-center gap-2">
                <Skull size={20} strokeWidth={2.2} className="text-destructive" />
                <h2 className="font-serif text-2xl">Nemesis List</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                The engine avoids anything that shares this style — asymmetric veto radius, wider than
                the attraction zone.
              </p>
              <div className="mt-6 space-y-10">
                {TYPE_ORDER.flatMap((t) => {
                  const rows = nemesisGrouped[t] ?? [];
                  if (rows.length === 0) return [];
                  return [
                    <TierSection
                      key={`nemesis-${t}`}
                      type={t}
                      tier="nemesis"
                      label={NEMESIS_TYPE_LABEL[t]}
                      rows={rows}
                      onDemote={(id) => demote.mutate(id)}
                    />,
                  ];
                })}
              </div>
            </div>
          )}
        </>
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

function TierSection({
  type, tier, label, rows, onDemote,
}: {
  type: WineType;
  tier: "canon" | "nemesis";
  label: string;
  rows: Row[];
  onDemote: (id: string) => void;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif text-xl">{label}</h2>
        <span className="text-[11px] text-muted-foreground">{rows.length} region{rows.length === 1 ? "" : "s"}</span>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {rows.map(({ canon, bottle }) => (
          <li key={canon.id} className="py-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <BenchmarkTierBadge tier={canon.tier} />
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
                const verb = tier === "canon" ? "Canon" : "Nemesis";
                if (confirm(`Remove ${verb} status from ${bottle.name}?`)) {
                  onDemote(canon.id);
                }
              }}
              className="shrink-0 text-[11px] text-muted-foreground hover:text-destructive underline underline-offset-2"
            >
              remove
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

