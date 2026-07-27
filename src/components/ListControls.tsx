import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import {
  SORT_OPTIONS,
  WINE_TYPE_OPTIONS,
  detectFormatsPresent,
  type Controls,
  type Priced,
  type ServingFormat,
} from "@/lib/list-controls";
import {
  priceBandOptions,
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@/lib/currency";

type Props = {
  value: Controls;
  onChange: (next: Controls) => void;
  idPrefix: string;
  currency?: CurrencyCode;
  /** Optional row set used to decide whether to show the format toggle. */
  rows?: Priced[];
};

function shortSort(v: Controls["sort"]): string {
  return SORT_OPTIONS.find((o) => o.value === v)?.label ?? "Sort";
}

/**
 * Filter/sort surface. Renders as a single compact pill; opens a bottom
 * sheet with all controls. Thumb-zone friendly, one-handed.
 */
export function ListControls({ value, onChange, idPrefix, currency, rows }: Props) {
  const [open, setOpen] = useState(false);

  const cur: CurrencyCode = currency ?? DEFAULT_CURRENCY;
  const priceOptions = useMemo(() => priceBandOptions(cur), [cur]);
  const shortPrice = (v: Controls["price"]) =>
    priceOptions.find((o) => o.value === v)?.label ?? "Any price";

  const formatsPresent = rows ? detectFormatsPresent(rows) : { glass: false, bottle: true };
  const showFormatToggle = formatsPresent.glass && formatsPresent.bottle;

  const filterCount =
    (value.sort !== "best" ? 1 : 0) +
    (value.price !== "all" ? 1 : 0) +
    (value.wineType && value.wineType !== "all" ? 1 : 0) +
    (value.catalogOnly ? 1 : 0) +
    (showFormatToggle && value.format !== "bottle" ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const typeLabel = WINE_TYPE_OPTIONS.find((o) => o.value === (value.wineType ?? "all"))?.label ?? "All types";
  const label = `${shortSort(value.sort)} \u00b7 ${typeLabel} \u00b7 ${shortPrice(value.price)}${value.catalogOnly ? " \u00b7 Catalog" : ""}`;

  const setFormat = (f: ServingFormat) => onChange({ ...value, format: f });

  return (
    <>
      <div className="mt-2 flex justify-end gap-2 items-center">
        {showFormatToggle && (
          <div
            role="tablist"
            aria-label="Serving format"
            className="inline-flex rounded-full border border-border bg-card p-0.5 text-xs font-medium"
          >
            {(["bottle", "glass"] as const).map((f) => {
              const active = value.format === f;
              return (
                <button
                  key={f}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={`min-h-9 rounded-full px-3 ${
                    active ? "bg-primary text-primary-foreground" : "text-foreground"
                  }`}
                >
                  {f === "bottle" ? "By the bottle" : "By the glass"}
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Filters — ${label}`}
          aria-expanded={open}
          className="inline-flex items-center gap-2 min-h-11 rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <SlidersHorizontal size={14} strokeWidth={2} />
          <span className="truncate max-w-[16rem]">{label}</span>
          {filterCount > 0 && (
            <span className="ml-1 rounded-full bg-primary text-primary-foreground text-meta font-semibold px-1.5 py-0.5">{filterCount}</span>
          )}
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="Sort and filter"
        >
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card shadow-2xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden />
            <div className="flex items-center justify-between px-5 pt-3 pb-2">
              <h3 className="text-base font-semibold">Sort & filter</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="min-h-11 min-w-11 -mr-2 rounded-md text-muted-foreground hover:text-foreground"
              >\u2715</button>
            </div>

            <div className="px-5 pb-2 space-y-4">
              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-label text-muted-foreground mb-2">Sort by</legend>
                <div className="grid grid-cols-1 gap-2">
                  {SORT_OPTIONS.map((o) => (
                    <label key={o.value} className="flex items-center gap-3 min-h-11 rounded-lg border border-border px-3 cursor-pointer">
                      <input
                        type="radio"
                        name={`${idPrefix}-sort`}
                        checked={value.sort === o.value}
                        onChange={() => onChange({ ...value, sort: o.value })}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-sm">{o.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {showFormatToggle && (
                <fieldset>
                  <legend className="text-xs font-semibold uppercase tracking-label text-muted-foreground mb-2">Serving</legend>
                  <div className="flex flex-wrap gap-2">
                    {(["bottle", "glass"] as const).map((f) => {
                      const active = value.format === f;
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => setFormat(f)}
                          className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
                            active
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-foreground hover:bg-accent"
                          }`}
                        >
                          {f === "bottle" ? "By the bottle" : "By the glass"}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-label text-muted-foreground mb-2">Wine type</legend>
                <div className="flex flex-wrap gap-2">
                  {WINE_TYPE_OPTIONS.map((o) => {
                    const active = (value.wineType ?? "all") === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => onChange({ ...value, wineType: o.value })}
                        className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-foreground hover:bg-accent"
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-label text-muted-foreground mb-2">Price</legend>
                <div className="flex flex-wrap gap-2">
                  {priceOptions.map((o) => {
                    const active = value.price === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => onChange({ ...value, price: o.value })}
                        className={`min-h-11 rounded-full border px-4 text-sm font-medium ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-foreground hover:bg-accent"
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={value.catalogOnly}
                  onChange={(e) => onChange({ ...value, catalogOnly: e.target.checked })}
                  className="h-5 w-5 accent-primary"
                />
                <span className="text-sm">Catalog matches only</span>
              </label>
            </div>

            <div className="px-5 pt-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full min-h-11 rounded-xl bg-primary text-primary-foreground text-sm font-semibold"
              >
                Show results
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
