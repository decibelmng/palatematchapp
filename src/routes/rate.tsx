import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { useRatings, useRate, useBottlesByIds, type BottleRow } from "@/hooks/use-palate-data";
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
  "id,name,producer,region,grape,vintage,type,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet";

type TypeFilter = "all" | "red" | "white" | "rose" | "sparkling";

function escapeLike(s: string) {
  // Escape PostgREST or-filter separators and SQL LIKE wildcards.
  return s.replace(/([\\%_,()])/g, "\\$1");
}

function tokenize(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0);
}

function useBottleSearch(query: string, typeFilter: TypeFilter, letter: string | null) {
  return useQuery({
    queryKey: ["bottles", "search", query, typeFilter, letter],
    queryFn: async (): Promise<BottleRow[]> => {
      const tokens = tokenize(query);
      let req = supabase.from("bottles").select(BOTTLE_COLS).order("name").limit(50);

      // Each token must match somewhere across name / producer / region / grape (AND of ORs).
      for (const tok of tokens) {
        const needle = `%${escapeLike(tok)}%`;
        req = req.or(
          [
            `name.ilike.${needle}`,
            `producer.ilike.${needle}`,
            `region.ilike.${needle}`,
            `grape.ilike.${needle}`,
          ].join(","),
        );
      }

      if (typeFilter !== "all") {
        const variants =
          typeFilter === "red" ? ["Red"]
          : typeFilter === "white" ? ["White"]
          : typeFilter === "rose" ? ["Rosé", "Rose"]
          : ["Sparkling"];
        req = req.in("type", variants);
      }

      if (letter) {
        if (letter === "#") {
          // Non-alphabetic starts (numbers, symbols).
          req = req.not("name", "ilike", "a%")
            .not("name", "ilike", "b%").not("name", "ilike", "c%").not("name", "ilike", "d%")
            .not("name", "ilike", "e%").not("name", "ilike", "f%").not("name", "ilike", "g%")
            .not("name", "ilike", "h%").not("name", "ilike", "i%").not("name", "ilike", "j%")
            .not("name", "ilike", "k%").not("name", "ilike", "l%").not("name", "ilike", "m%")
            .not("name", "ilike", "n%").not("name", "ilike", "o%").not("name", "ilike", "p%")
            .not("name", "ilike", "q%").not("name", "ilike", "r%").not("name", "ilike", "s%")
            .not("name", "ilike", "t%").not("name", "ilike", "u%").not("name", "ilike", "v%")
            .not("name", "ilike", "w%").not("name", "ilike", "x%").not("name", "ilike", "y%")
            .not("name", "ilike", "z%");
        } else {
          req = req.ilike("name", `${escapeLike(letter)}%`);
        }
      }

      const { data, error } = await req;
      if (error) throw error;
      return (data ?? []) as BottleRow[];
    },
    staleTime: 30_000,
    enabled: query.trim().length > 0 || typeFilter !== "all" || letter !== null,
  });
}

function typeLabel(t: string | null): string | null {
  if (!t) return null;
  return t;
}

function typeTone(t: string | null): string {
  const v = (t ?? "").toLowerCase();
  if (v.startsWith("red")) return "bg-[hsl(0_55%_28%/0.25)] text-[hsl(0_70%_75%)] border-[hsl(0_55%_40%/0.4)]";
  if (v.startsWith("white")) return "bg-[hsl(48_60%_30%/0.18)] text-[hsl(48_70%_75%)] border-[hsl(48_60%_45%/0.35)]";
  if (v.startsWith("ros")) return "bg-[hsl(340_50%_35%/0.22)] text-[hsl(340_70%_80%)] border-[hsl(340_50%_50%/0.4)]";
  if (v.startsWith("spark")) return "bg-[hsl(200_50%_30%/0.22)] text-[hsl(200_70%_80%)] border-[hsl(200_50%_50%/0.4)]";
  return "bg-muted text-muted-foreground border-border";
}

const TYPE_OPTIONS: { id: TypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "red", label: "Red" },
  { id: "white", label: "White" },
  { id: "rose", label: "Rosé" },
  { id: "sparkling", label: "Sparkling" },
];

function Rate() {
  const { data: ratings } = useRatings();
  const rate = useRate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data: results, isFetching } = useBottleSearch(debounced, typeFilter);

  const ratingMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ratings ?? []) m.set(r.bottle_id, r.stars);
    return m;
  }, [ratings]);

  // When idle (no query, no filter), show the user's most-recently-rated bottles
  // so they can quickly re-find and adjust them.
  const recentRatedIds = useMemo(() => {
    if (!ratings) return [];
    // Show most recent ratings first; ratings come back ordered by created_at desc.
    return ratings.slice(0, 25).map((r) => r.bottle_id);
  }, [ratings]);

  const { data: recentRated } = useBottlesByIds(recentRatedIds);

  const idle = debounced.trim().length === 0 && typeFilter === "all";
  const list = idle ? (recentRated ?? []) : (results ?? []);

  const ratedCount = ratings?.length ?? 0;

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Rate</p>
      <h1 className="font-serif text-3xl mt-2">Tap stars on bottles you've tried</h1>

      {ratedCount > 0 && (
        <div className="mt-5 rounded-lg border border-border bg-card p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {ratedCount} rated · ready for what's next?
          </p>
          <div className="flex gap-2">
            <Link
              to="/"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Your palate
            </Link>
            <Link
              to="/pour"
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90"
            >
              Pour next →
            </Link>
          </div>
        </div>
      )}

      <div className="mt-5 relative">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, producer, region or grape…"
          className="w-full rounded-md bg-input border border-border pl-9 pr-9 py-2.5 text-sm outline-none focus:border-primary"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">⌕</span>
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            ×
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {TYPE_OPTIONS.map((opt) => {
          const active = typeFilter === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setTypeFilter(opt.id)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {idle
          ? recentRatedIds.length > 0
            ? `Your ${recentRated?.length ?? 0} most recent ratings — search above to add more.`
            : "Try searching a producer, grape (e.g. \"pinot noir\"), or region (e.g. \"napa\")."
          : isFetching
            ? "Searching…"
            : `${list.length} result${list.length === 1 ? "" : "s"}${list.length === 50 ? " (refine to narrow)" : ""}`}
      </p>

      <ul className="mt-2 divide-y divide-border">
        {list.map((b) => {
          const v = ratingMap.get(b.id) ?? null;
          const tLabel = typeLabel(b.type);
          return (
            <li key={b.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight truncate">{b.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[b.producer, b.region, b.grape, b.vintage].filter(Boolean).join(" · ")}
                </p>
                {tLabel && (
                  <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${typeTone(b.type)}`}>
                    {tLabel}
                  </span>
                )}
              </div>
              <StarTap
                value={v}
                onChange={(stars) => rate.mutate({ bottleId: b.id, stars })}
              />
            </li>
          );
        })}
        {!isFetching && !idle && list.length === 0 && (
          <li className="py-6 text-sm text-muted-foreground">
            No matches. Try fewer words, a different spelling, or remove the type filter.
          </li>
        )}
        {idle && recentRatedIds.length === 0 && (
          <li className="py-6 text-sm text-muted-foreground">
            Start typing to find a bottle you've tried.
          </li>
        )}
      </ul>
    </div>
  );
}
