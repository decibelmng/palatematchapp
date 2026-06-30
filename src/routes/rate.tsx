import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AuthGate } from "@/components/AuthGate";
import { useRatings, useRate, useBottlesByIds, type BottleRow } from "@/hooks/use-palate-data";
import { StarTap } from "@/components/StarTap";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import { supabase } from "@/integrations/supabase/client";
import { AddBottleDialog } from "@/components/AddBottleDialog";

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
  "id,name,producer,region,grape,vintage,type,fp_fresh,fp_acid,fp_tannin,fp_fruit_dark,fp_ripe,fp_oak,fp_body,fp_savory,ax_body,ax_fruit_char,ax_tannin,ax_acidity,ax_sweet,tasting_note,source,added_by,critic_score";

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

function typeVariantsFor(typeFilter: TypeFilter): string[] | null {
  if (typeFilter === "all") return null;
  if (typeFilter === "red") return ["Red"];
  if (typeFilter === "white") return ["White"];
  if (typeFilter === "rose") return ["Rosé", "Rose"];
  return ["Sparkling"];
}

function useFuzzySearch(query: string, typeFilter: TypeFilter, enabled: boolean) {
  return useQuery({
    queryKey: ["bottles", "fuzzy", query, typeFilter],
    enabled: enabled && query.trim().length >= 3,
    staleTime: 30_000,
    queryFn: async (): Promise<BottleRow[]> => {
      const { data, error } = await supabase.rpc("search_bottles_fuzzy", {
        q: query.trim(),
        type_variants: typeVariantsFor(typeFilter) ?? undefined,
        lim: 25,
        threshold: 0.35,
      });
      if (error) throw error;
      return (data ?? []) as BottleRow[];
    },
  });
}

function typeLabel(t: string | null): string | null {
  if (!t) return null;
  return t;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function useLetterCounts(typeFilter: TypeFilter) {
  return useQuery({
    queryKey: ["bottles", "letterCounts", typeFilter],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, number>> => {
      const variants =
        typeFilter === "all" ? null
        : typeFilter === "red" ? ["Red"]
        : typeFilter === "white" ? ["White"]
        : typeFilter === "rose" ? ["Rosé", "Rose"]
        : ["Sparkling"];

      const letters = [...ALPHABET, "#"];
      const results = await Promise.all(letters.map(async (L) => {
        let req = supabase.from("bottles").select("id", { count: "exact", head: true });
        if (variants) req = req.in("type", variants);
        if (L === "#") {
          for (const A of ALPHABET) req = req.not("name", "ilike", `${A}%`);
        } else {
          req = req.ilike("name", `${L}%`);
        }
        const { count, error } = await req;
        if (error) throw error;
        return [L, count ?? 0] as const;
      }));
      return Object.fromEntries(results);
    },
  });
}

// (badge styling lives in <WineTypeBadge />)

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
  const [letter, setLetter] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data: results, isFetching } = useBottleSearch(debounced, typeFilter, letter);
  const { data: letterCounts } = useLetterCounts(typeFilter);

  const exactEmpty = !isFetching && (results?.length ?? 0) === 0 && debounced.trim().length >= 3;
  const { data: fuzzy, isFetching: fuzzyFetching } = useFuzzySearch(debounced, typeFilter, exactEmpty);

  const ratingMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ratings ?? []) m.set(r.bottle_id, r.stars);
    return m;
  }, [ratings]);

  const recentRatedIds = useMemo(() => {
    if (!ratings) return [];
    return ratings.slice(0, 25).map((r) => r.bottle_id);
  }, [ratings]);

  const { data: recentRated } = useBottlesByIds(recentRatedIds);

  const idle = debounced.trim().length === 0 && typeFilter === "all" && letter === null;
  const list = idle ? (recentRated ?? []) : (results ?? []);
  const showFuzzy = exactEmpty && (fuzzy?.length ?? 0) > 0;

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

      <div className="mt-3 -mx-1 overflow-x-auto">
        <div className="flex gap-0.5 px-1 min-w-max items-stretch">
          {(["#", ...ALPHABET] as string[]).map((L) => {
            const active = letter === L;
            const count = letterCounts?.[L];
            const isZero = count === 0;
            return (
              <button
                key={L}
                onClick={() => setLetter(active ? null : L)}
                disabled={isZero}
                aria-label={`Filter names starting with ${L}${count != null ? ` (${count})` : ""}`}
                className={`min-w-[26px] py-1 px-1 rounded flex flex-col items-center justify-center leading-none transition ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : isZero
                      ? "text-muted-foreground/30 cursor-not-allowed"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                <span className="text-[11px] font-medium">{L}</span>
                <span className={`text-[8px] mt-0.5 tabular-nums ${active ? "opacity-80" : "opacity-60"}`}>
                  {count == null ? "·" : count > 999 ? `${Math.floor(count / 1000)}k` : count}
                </span>
              </button>
            );
          })}
          {letter && (
            <button
              onClick={() => setLetter(null)}
              className="ml-1 h-7 px-2 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent self-center"
            >
              clear
            </button>
          )}
        </div>
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
          return (
            <li key={b.id} className="py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight truncate">{b.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {[b.producer, b.region, b.grape, b.vintage].filter(Boolean).join(" · ")}
                </p>
                <div className="mt-1"><WineTypeBadge type={b.type} /></div>
              </div>
              <StarTap
                value={v}
                onChange={(stars) => rate.mutate({ bottleId: b.id, stars })}
              />
            </li>
          );
        })}
        {!isFetching && !idle && list.length === 0 && !showFuzzy && (
          <li className="py-6 text-sm text-muted-foreground">
            {fuzzyFetching
              ? "No exact matches — looking for close spellings…"
              : "No matches, even with typo-tolerant search. Try fewer words or remove the type filter."}
          </li>
        )}
        {showFuzzy && (
          <>
            <li className="pt-5 pb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Did you mean… (close spellings)
            </li>
            {(fuzzy ?? []).map((b) => {
              const v = ratingMap.get(b.id) ?? null;
              return (
                <li key={b.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight truncate">{b.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[b.producer, b.region, b.grape, b.vintage].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-1"><WineTypeBadge type={b.type} /></div>
                  </div>
                  <StarTap
                    value={v}
                    onChange={(stars) => rate.mutate({ bottleId: b.id, stars })}
                  />
                </li>
              );
            })}
          </>
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
