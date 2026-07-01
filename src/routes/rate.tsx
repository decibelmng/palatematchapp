import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, ArrowRight } from "lucide-react";
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

type AddForm = {
  producer: string;
  name: string;
  type: "red" | "white" | "sparkling" | "rose" | "dessert";
  region: string;
  country: string;
  grape: string;
  vintage: string;
  price_band: string;
};

const EMPTY_ADD: AddForm = {
  producer: "", name: "", type: "red",
  region: "", country: "", grape: "", vintage: "", price_band: "",
};

function Rate() {
  const { data: ratings } = useRatings();
  const rate = useRate();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [letter, setLetter] = useState<string | null>(null);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD);
  const [addOpen, setAddOpen] = useState(false);
  const [addAutoStart, setAddAutoStart] = useState(false);

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
  const [showAllRecent, setShowAllRecent] = useState(false);
  const fullList = idle ? (recentRated ?? []) : (results ?? []);
  const list = idle && !showAllRecent ? fullList.slice(0, 5) : fullList;
  const hiddenCount = idle && !showAllRecent ? Math.max(0, fullList.length - 5) : 0;
  const showFuzzy = exactEmpty && (fuzzy?.length ?? 0) > 0;

  const ratedCount = ratings?.length ?? 0;
  const addFormRef = useMemo(() => ({ current: null as HTMLDivElement | null }), []);

  function jumpToAddForm(prefillName?: string) {
    if (prefillName) {
      // Try to split "Producer — Wine" if user typed that; otherwise put in name.
      setAddForm((f) => ({ ...f, name: prefillName, producer: f.producer || "" }));
    }
    addFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => {
      const el = document.getElementById("add-bottle-producer");
      el?.focus();
    }, 350);
  }

  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.producer.trim() || !addForm.name.trim()) return;
    setAddAutoStart(true);
    setAddOpen(true);
  }

  const canSubmitAdd = addForm.producer.trim().length > 0 && addForm.name.trim().length > 0;

  return (
    <div className="pt-2">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Rate</p>
        <h1 className="font-serif text-3xl mt-2">Tap stars on bottles you've tried</h1>
      </div>

      {ratedCount > 0 && (
        <div className="mt-5 flex items-center justify-between gap-3 px-1">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{ratedCount}</span> rated · ready for what's next?
          </p>
          <div className="flex gap-3">
            <Link
              to="/"
              className="text-xs font-medium text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              Your palate
            </Link>
            <Link
              to="/pour"
              className="text-xs font-semibold text-primary hover:opacity-80"
            >
              Pour next →
            </Link>
          </div>
        </div>
      )}

      {/* ============ ZONE 1: FIND A WINE ============ */}
      <section aria-labelledby="find-heading" className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="find-heading" className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-medium">
            Find a wine
          </h2>
          <span className="text-[10px] text-muted-foreground/70">Search 118k+ bottles already in the catalog</span>
        </div>

        <div className="mt-2 flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search
              aria-hidden
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              size={16}
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search wines already in the catalog…"
              aria-label="Search the wine catalog"
              className="w-full rounded-full bg-muted/50 border border-transparent pl-10 pr-9 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:bg-background focus:border-border transition"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => jumpToAddForm()}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border-2 border-primary text-primary bg-background px-3.5 py-2 text-xs font-semibold hover:bg-primary hover:text-primary-foreground transition whitespace-nowrap"
            aria-label="Add a bottle that isn't in the catalog"
          >
            <Plus size={14} strokeWidth={2.5} /> Add a bottle
          </button>
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

        {/* Empty-search bridge to Add-a-bottle */}
        {!isFetching && !idle && list.length === 0 && !showFuzzy && !fuzzyFetching && (
          <div className="mt-3 rounded-lg border border-dashed border-border bg-muted/30 p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Can't find "{debounced.trim()}"?</p>
              <p className="text-xs text-muted-foreground mt-0.5">Add it manually — we'll research the style for you.</p>
            </div>
            <button
              type="button"
              onClick={() => jumpToAddForm(debounced.trim())}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-2 text-xs font-semibold hover:opacity-90"
            >
              Add it manually <ArrowRight size={14} />
            </button>
          </div>
        )}
        {!isFetching && !idle && list.length === 0 && !showFuzzy && fuzzyFetching && (
          <p className="mt-3 text-sm text-muted-foreground">No exact matches — looking for close spellings…</p>
        )}
      </section>

      {/* ============ ZONE 2: ADD A NEW BOTTLE ============ */}
      <section
        aria-labelledby="add-heading"
        className="mt-10 rounded-2xl border-2 border-border bg-card p-5 shadow-sm"
        ref={(el) => { addFormRef.current = el as HTMLDivElement | null; }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="add-heading" className="font-serif text-xl">Add a new bottle</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Not in the catalog? Fill in what you know and we'll research the rest.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider">
            <Plus size={12} /> New
          </span>
        </div>

        <form onSubmit={submitAdd} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AddField
              id="add-bottle-producer"
              label="Producer"
              required
              value={addForm.producer}
              onChange={(v) => setAddForm({ ...addForm, producer: v })}
              placeholder="e.g. Le Macchiole"
            />
            <AddField
              id="add-bottle-name"
              label="Cuvée / Name"
              required
              value={addForm.name}
              onChange={(v) => setAddForm({ ...addForm, name: v })}
              placeholder="e.g. Le Colonne Bolgheri"
            />
            <AddField
              id="add-bottle-region"
              label="Region"
              value={addForm.region}
              onChange={(v) => setAddForm({ ...addForm, region: v })}
              placeholder="Toscana, Bolgheri"
            />
            <AddField
              id="add-bottle-grape"
              label="Grape(s)"
              value={addForm.grape}
              onChange={(v) => setAddForm({ ...addForm, grape: v })}
              placeholder="Merlot, Petit Verdot"
            />
            <AddField
              id="add-bottle-vintage"
              label="Vintage"
              value={addForm.vintage}
              onChange={(v) => setAddForm({ ...addForm, vintage: v.replace(/[^0-9]/g, "").slice(0, 4) })}
              placeholder="2022"
              inputMode="numeric"
            />
            <div className="block">
              <label htmlFor="add-bottle-type" className="block text-xs font-medium text-foreground mb-1.5">
                Type <span className="text-destructive">*</span>
              </label>
              <select
                id="add-bottle-type"
                value={addForm.type}
                onChange={(e) => setAddForm({ ...addForm, type: e.target.value as AddForm["type"] })}
                className="w-full rounded-md bg-background border border-input px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
              >
                <option value="red">Red</option>
                <option value="white">White</option>
                <option value="rose">Rosé</option>
                <option value="sparkling">Sparkling</option>
                <option value="dessert">Dessert</option>
              </select>
            </div>
            <AddField
              id="add-bottle-price"
              label="Price band"
              value={addForm.price_band}
              onChange={(v) => setAddForm({ ...addForm, price_band: v })}
              placeholder="$$, $$$"
            />
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 border-t border-border">
            <p className="text-[11px] text-muted-foreground">
              We'll estimate a calibrated fingerprint on the same scale as the catalog.
            </p>
            <button
              type="submit"
              disabled={!canSubmitAdd}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              Research & add bottle <ArrowRight size={16} />
            </button>
          </div>
        </form>
      </section>

      <AddBottleDialog
        open={addOpen}
        onClose={() => { setAddOpen(false); setAddAutoStart(false); }}
        initialForm={addForm}
        autoStart={addAutoStart}
      />
    </div>
  );
}

function AddField({
  id, label, value, onChange, placeholder, required, inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  inputMode?: "text" | "numeric";
}) {
  return (
    <div className="block">
      <label htmlFor={id} className="block text-xs font-medium text-foreground mb-1.5">
        {label}{required && <span className="text-destructive"> *</span>}
      </label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md bg-background border border-input px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
      />
    </div>
  );
}

