import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useBottlesByIds, useRatings, useRate } from "@/hooks/use-palate-data";
import { StarTap } from "@/components/StarTap";

export const Route = createFileRoute("/my-ratings")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Your ratings — Palate Match" },
      { name: "description", content: "Edit or remove the bottles that make up your palate code." },
    ],
  }),
  component: () => <AuthGate><MyRatings /></AuthGate>,
});

type SortKey = "recent" | "high" | "low" | "name";

function MyRatings() {
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: bottles, isLoading } = useBottlesByIds(ratedIds);
  const rate = useRate();
  const [sort, setSort] = useState<SortKey>("recent");

  const rows = useMemo(() => {
    const byId = new Map((bottles ?? []).map((b) => [b.id, b]));
    const list = (ratings ?? [])
      .map((r, i) => {
        const b = byId.get(r.bottle_id);
        return b ? { stars: r.stars, bottle: b, order: i } : null;
      })
      .filter(Boolean) as { stars: number; bottle: NonNullable<ReturnType<typeof byId.get>>; order: number }[];

    switch (sort) {
      case "high": list.sort((a, b) => b.stars - a.stars); break;
      case "low":  list.sort((a, b) => a.stars - b.stars); break;
      case "name": list.sort((a, b) => a.bottle.name.localeCompare(b.bottle.name)); break;
      default:     list.sort((a, b) => b.order - a.order);
    }
    return list;
  }, [ratings, bottles, sort]);

  const count = ratings?.length ?? 0;

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Your ratings</p>
      <h1 className="font-serif text-3xl mt-2">The bottles behind your palate</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tap a star to change a rating, or hit <em>clear</em> to remove it. Your palate code updates as you edit.
      </p>

      {count === 0 ? (
        <div className="mt-8 rounded-xl border border-border bg-card/60 p-5">
          <p className="text-sm text-muted-foreground">You haven't rated anything yet.</p>
          <Link
            to="/rate"
            className="mt-4 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            Rate a bottle
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{count} bottle{count === 1 ? "" : "s"}</p>
            <label className="text-xs text-muted-foreground flex items-center gap-2">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="bg-input border border-border rounded-md px-2 py-1 text-xs"
              >
                <option value="recent">Recently added</option>
                <option value="high">Highest first</option>
                <option value="low">Lowest first</option>
                <option value="name">Name (A–Z)</option>
              </select>
            </label>
          </div>

          <ul className="mt-3 divide-y divide-border">
            {isLoading && rows.length === 0 && (
              <li className="py-6 text-sm text-muted-foreground">Loading…</li>
            )}
            {rows.map(({ bottle: b, stars }) => (
              <li key={b.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">{b.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[b.producer, b.region, b.vintage].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <StarTap
                  value={stars}
                  onChange={(s) => rate.mutate({ bottleId: b.id, stars: s })}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
