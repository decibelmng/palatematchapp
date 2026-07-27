import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { Crown, Skull, Star, Sparkles } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { YourRatingsList } from "@/components/YourRatingsList";
import { useMyCanons } from "@/hooks/use-canon";
import { useBottlesByIds, useRatings, bottleType } from "@/hooks/use-palate-data";
import { WineTypeBadge } from "@/components/WineTypeBadge";

type Tab = "rated" | "canons" | "nemeses" | "scored";
const TABS: { id: Tab; label: string; Icon: typeof Star }[] = [
  { id: "rated", label: "Rated", Icon: Star },
  { id: "canons", label: "Favorites", Icon: Crown },
  { id: "nemeses", label: "Avoid", Icon: Skull },
  { id: "scored", label: "Scored", Icon: Sparkles },
];


const searchSchema = z.object({
  tab: z.enum(["rated", "canons", "nemeses", "scored"]).optional(),
});

export const Route = createFileRoute("/wines")({
  ssr: false,
  validateSearch: (s) => searchSchema.parse(s),
  head: () => ({
    meta: [
      { title: "Your wines — Palate Match" },
      { name: "description", content: "All the wines you've rated, your favorites, the ones you avoid, and your scored map." },
    ],
  }),
  component: () => <AuthGate><WinesPage /></AuthGate>,
});

function WinesPage() {
  const search = useSearch({ from: "/wines" });
  const tab: Tab = search.tab ?? "rated";

  return (
    <div className="pt-3 pb-8">
      <h1 className="font-serif text-2xl">Your wines</h1>

      <nav className="mt-4 grid grid-cols-4 gap-1.5" role="tablist">
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <Link
              key={id}
              to="/wines"
              search={{ tab: id }}
              role="tab"
              aria-selected={active}
              className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-meta transition ${
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-5">
        {tab === "rated" && <YourRatingsList />}
        {tab === "canons" && <BenchmarkList tier="canon" />}
        {tab === "nemeses" && <BenchmarkList tier="nemesis" />}
        {tab === "scored" && <ScoredHint />}
      </div>
    </div>
  );
}

function BenchmarkList({ tier }: { tier: "canon" | "nemesis" }) {
  const { data: canons = [], isLoading } = useMyCanons();
  const rows = useMemo(() => canons.filter((c) => c.tier === tier), [canons, tier]);
  const bottleIds = rows.map((r) => r.bottle_id);
  const { data: bottles = [] } = useBottlesByIds(bottleIds);
  const byId = new Map(bottles.map((b) => [b.id, b]));

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center">
        <p className="text-sm">No {tier === "canon" ? "favorites" : "wines to avoid"} yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Rate a wine 5 stars and mark it as a favorite — or 1 star and mark it as one to avoid — to anchor your palate.
        </p>

      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const b = byId.get(r.bottle_id);
        if (!b) return null;
        return (
          <li key={r.id} className="py-3">
            <Link to="/wine/$id" params={{ id: b.id }} className="block group">
              <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:underline">{b.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {[b.producer, b.region, b.grape, b.vintage].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-1"><WineTypeBadge type={b.type} /></div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ScoredHint() {
  const { data: ratings = [] } = useRatings();
  const { data: bottles = [] } = useBottlesByIds(ratings.map((r) => r.bottle_id));
  const redCount = bottles.filter((b) => bottleType(b) === "red").length;
  const whiteCount = bottles.filter((b) => bottleType(b) === "white").length;

  return (
    <div className="grid grid-cols-2 gap-3">
      <Link to="/palate/$type" params={{ type: "red" }} className="rounded-lg border border-border bg-card p-4 hover:border-primary/60 transition">
        <p className="text-meta uppercase tracking-label text-muted-foreground">Red</p>
        <p className="mt-1 font-serif text-2xl">{redCount}</p>
        <p className="mt-1 text-meta text-muted-foreground">Open map + 3D →</p>
      </Link>
      <Link to="/palate/$type" params={{ type: "white" }} className="rounded-lg border border-border bg-card p-4 hover:border-primary/60 transition">
        <p className="text-meta uppercase tracking-label text-muted-foreground">White</p>
        <p className="mt-1 font-serif text-2xl">{whiteCount}</p>
        <p className="mt-1 text-meta text-muted-foreground">Open map + 3D →</p>
      </Link>
    </div>
  );
}
