import { useMemo, useState } from "react";
import { ListControls } from "@/components/ListControls";
import { applyControlsGrouped, DEFAULT_CONTROLS, type Controls } from "@/lib/list-controls";
import type { CurrencyCode } from "@/lib/currency";
import type { ScanRow } from "./types";
import { ResultRow, SkeletonRow } from "./ResultRow";

export function TheRest({
  rows, pendingSkeletons, onOpen, stillReading, currency,
  orderedBottleId, onOrdered, orderPending, canOrder,
}: {
  rows: ScanRow[];
  pendingSkeletons: number;
  onOpen: (key: string) => void;
  stillReading: boolean;
  currency?: CurrencyCode;
  orderedBottleId?: string | null;
  onOrdered?: (row: ScanRow) => void;
  orderPending?: boolean;
  canOrder?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  const [showAll, setShowAll] = useState(false);
  const PAGE = 40;

  const groups = useMemo(() => applyControlsGrouped(rows, controls), [rows, controls]);
  const filtered = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const limit = showAll ? filtered.length : PAGE;
  // Slice across groups so the labelled tail keeps its position in the order.
  const visibleGroups = useMemo(() => {
    let left = limit;
    const out: { label: string | null; rows: ScanRow[] }[] = [];
    for (const g of groups) {
      if (left <= 0) break;
      out.push({ label: g.label, rows: g.rows.slice(0, left) });
      left -= Math.min(left, g.rows.length);
    }
    return out;
  }, [groups, limit]);
  const hidden = Math.max(0, filtered.length - Math.min(filtered.length, limit));
  const total = rows.length;


  if (total === 0 && pendingSkeletons === 0) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        className="mt-6 w-full rounded-xl border border-border bg-card p-4 text-left flex items-center justify-between focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:bg-accent/40"
      >
        <span className="text-sub text-foreground font-medium">
          See all {total} wine{total === 1 ? "" : "s"}
          {stillReading && <span className="text-muted-foreground"> · still reading…</span>}
        </span>
        <span aria-hidden className="text-muted-foreground">▾</span>
      </button>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <p className="text-label uppercase tracking-label text-muted-foreground">
          Full list
          {stillReading && <span className="ml-2 normal-case tracking-normal">· still reading…</span>}
        </p>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-meta text-muted-foreground underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          Collapse
        </button>
      </div>
      <ListControls value={controls} onChange={setControls} idPrefix="verdict-rest" currency={currency} rows={rows} />
      {filtered.length === 0 ? (
        <p className="mt-4 text-sub text-muted-foreground">No wines match those filters.</p>
      ) : (
        <div className="mt-3">
          {visibleGroups.map((g, gi) => (
            <div key={g.label ?? `g-${gi}`}>
              {g.label && (
                <p className="mt-4 mb-1 text-label uppercase tracking-label text-muted-foreground">
                  {g.label}
                </p>
              )}
              <ul className="divide-y divide-border">
                {g.rows.map((r) => (
                  <ResultRow
                    key={r.key}
                    row={r}
                    onOpen={() => onOpen(r.key)}
                    ordered={!!orderedBottleId && orderedBottleId === r.ranked.bottle.id}
                    onOrdered={onOrdered ? () => onOrdered(r) : undefined}
                    orderPending={orderPending}
                    canOrder={canOrder}
                  />
                ))}
                {gi === visibleGroups.length - 1 &&
                  Array.from({ length: pendingSkeletons }).map((_, i) => (
                    <SkeletonRow key={`sk-${i}`} />
                  ))}
              </ul>
            </div>
          ))}
        </div>

      )}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 w-full rounded-lg border border-border bg-card px-4 min-h-11 text-sub text-foreground font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:bg-accent/40"
        >
          +{hidden} more
        </button>
      )}
    </div>
  );
}
