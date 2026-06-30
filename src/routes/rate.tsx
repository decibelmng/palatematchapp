import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { useRatings, useRate, type BottleRow } from "@/hooks/use-palate-data";
import { StarTap } from "@/components/StarTap";
import { supabase } from "@/integrations/supabase/client";


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

const BOTTLE_COLS =
  "id,name,producer,region,grape,vintage,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet";

function escapeLike(s: string) {
  // Escape PostgREST or-filter separators and SQL LIKE wildcards.
  return s.replace(/([\\%_,()])/g, "\\$1");
}

function useBottleSearch(query: string) {
  return useQuery({
    queryKey: ["bottles", "search", query],
    queryFn: async (): Promise<BottleRow[]> => {
      const q = query.trim();
      let req = supabase.from("bottles").select(BOTTLE_COLS).order("name").limit(50);
      if (q) {
        const needle = `%${escapeLike(q)}%`;
        req = req.or(`name.ilike.${needle},producer.ilike.${needle}`);
      }
      const { data, error } = await req;
      if (error) throw error;
      return (data ?? []) as BottleRow[];
    },
    staleTime: 30_000,
  });
}

function Rate() {
  const { data: ratings } = useRatings();
  const rate = useRate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data: results, isFetching } = useBottleSearch(debounced);

  const ratingMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ratings ?? []) m.set(r.bottle_id, r.stars);
    return m;
  }, [ratings]);

  const list = results ?? [];

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Rate</p>
      <h1 className="font-serif text-3xl mt-2">Tap stars on bottles you've tried</h1>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name or producer…"
        className="mt-5 w-full rounded-md bg-input border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
      />

      <ul className="mt-4 divide-y divide-border">
        {list.map((b) => {
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
        {!isFetching && list.length === 0 && (
          <li className="py-6 text-sm text-muted-foreground">No matches.</li>
        )}
      </ul>
    </div>
  );
}
