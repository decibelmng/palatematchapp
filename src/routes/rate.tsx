import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Plus, ArrowRight } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useRatings, useRate, useBottlesByIds, type BottleRow } from "@/hooks/use-palate-data";
import { StarTap } from "@/components/StarTap";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import { YourRatingsList } from "@/components/YourRatingsList";
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

type TypeFilter = "all" | "red" | "white" | "rose" | "sparkling";

function typeVariantsFor(typeFilter: TypeFilter): string[] | undefined {
  if (typeFilter === "all") return undefined;
  if (typeFilter === "red") return ["Red"];
  if (typeFilter === "white") return ["White"];
  if (typeFilter === "rose") return ["Rosé", "Rose"];
  return ["Sparkling"];
}

function useBottleSearch(query: string, typeFilter: TypeFilter) {
  const q = query.trim();
  return useQuery({
    queryKey: ["bottles", "fuzzy-search", q, typeFilter],
    enabled: q.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<BottleRow[]> => {
      const { data, error } = await supabase.rpc("search_bottles_fuzzy", {
        q,
        type_variants: typeVariantsFor(typeFilter),
        lim: 50,
        threshold: 0.25,
      });
      if (error) throw error;
      return (data ?? []) as BottleRow[];
    },
  });
}

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
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD);
  const [addOpen, setAddOpen] = useState(false);
  const [addAutoStart, setAddAutoStart] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: results, isFetching } = useBottleSearch(debounced, typeFilter);

  const ratingMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ratings ?? []) m.set(r.bottle_id, r.stars);
    return m;
  }, [ratings]);

  const searching = debounced.trim().length > 0;
  const list = results ?? [];

  const ratedCount = ratings?.length ?? 0;
  const addFormRef = useMemo(() => ({ current: null as HTMLDivElement | null }), []);

  function jumpToAddForm(prefillName?: string) {
    if (prefillName) {
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
              className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              size={18}
            />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search wines already in the catalog…"
              aria-label="Search the wine catalog"
              className="w-full rounded-xl bg-input-strong text-input-strong-border border-2 border-input-strong-border pl-11 pr-10 py-3.5 text-base outline-none placeholder:text-input-strong-border/50 shadow-md focus:ring-4 focus:ring-primary/30 transition"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => jumpToAddForm()}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border-2 border-primary text-primary bg-background px-4 py-3.5 text-sm font-semibold hover:bg-primary hover:text-primary-foreground transition whitespace-nowrap shadow-sm"
            aria-label="Add a bottle that isn't in the catalog"
          >
            <Plus size={16} strokeWidth={2.5} /> Add a bottle
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

        {searching && (
          <>
            <p className="mt-3 text-[11px] text-muted-foreground">
              {isFetching
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
            </ul>

            {!isFetching && list.length === 0 && (
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
          </>
        )}
      </section>

      {/* ============ ZONE 2: YOUR RATINGS (hidden while searching) ============ */}
      {!searching && (
        <section aria-labelledby="your-ratings-heading" className="mt-10">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="your-ratings-heading" className="font-serif text-xl">Your ratings</h2>
            <span className="text-[10px] text-muted-foreground/70">Edit stars, add notes, group by vintage</span>
          </div>
          <div className="mt-3">
            <YourRatingsList />
          </div>
        </section>
      )}

      {/* ============ ZONE 3: ADD A NEW BOTTLE ============ */}
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
