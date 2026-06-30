import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useBottles, useRatings, useRate } from "@/hooks/use-palate-data";
import { StarTap } from "@/components/StarTap";

export const Route = createFileRoute("/rate")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Rate bottles — Palate Match" },
      { name: "description", content: "Search bottles you've tried and tap a 1–5 star rating." },
    ],
  }),
  component: () => <AuthGate><Rate /></AuthGate>,
});

function Rate() {
  const { data: bottles } = useBottles();
  const { data: ratings } = useRatings();
  const rate = useRate();
  const [q, setQ] = useState("");

  const ratingMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ratings ?? []) m.set(r.bottle_id, r.stars);
    return m;
  }, [ratings]);

  const filtered = useMemo(() => {
    const list = bottles ?? [];
    if (!q.trim()) return list.slice(0, 40);
    const needle = q.toLowerCase();
    return list
      .filter((b) =>
        b.name.toLowerCase().includes(needle) ||
        (b.producer ?? "").toLowerCase().includes(needle) ||
        (b.region ?? "").toLowerCase().includes(needle) ||
        (b.grape ?? "").toLowerCase().includes(needle)
      )
      .slice(0, 60);
  }, [bottles, q]);

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Rate</p>
      <h1 className="font-serif text-3xl mt-2">Tap stars on bottles you've tried</h1>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, producer, region, grape…"
        className="mt-5 w-full rounded-md bg-input border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
      />

      <ul className="mt-4 divide-y divide-border">
        {filtered.map((b) => {
          const v = ratingMap.get(b.id) ?? null;
          return (
            <li key={b.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight truncate">{b.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[b.producer, b.region, b.vintage].filter(Boolean).join(" · ")}
                </p>
              </div>
              <StarTap
                value={v}
                onChange={(stars) => rate.mutate({ bottleId: b.id, stars })}
              />
            </li>
          );
        })}
        {(bottles?.length ?? 0) === 0 && (
          <li className="py-6 text-sm text-muted-foreground">
            No bottles in the cellar yet. Seed the <code>bottles</code> table to get started.
          </li>
        )}
        {bottles && bottles.length > 0 && filtered.length === 0 && (
          <li className="py-6 text-sm text-muted-foreground">No matches.</li>
        )}
      </ul>
    </div>
  );
}
