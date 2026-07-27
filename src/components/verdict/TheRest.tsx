import { useMemo, useState } from "react";
import { ListControls } from "@/components/ListControls";
import { applyControls, DEFAULT_CONTROLS, type Controls } from "@/lib/list-controls";
import type { ScanRow } from "./types";
import { ResultRow, SkeletonRow } from "./ResultRow";

/**
 * Layer 3 — collapsed by default. Reveals ranked list + ListControls.
 * No silent truncation: every hidden wine is either visible or gated behind
 * a "+N more" real control.
 */
export function TheRest({
  rows, pendingSkeletons, onOpen, stillReading,
}: {
  rows: ScanRow[];
  pendingSkeletons: number;
  onOpen: (key: string) => void;
  stillReading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  const [showAll, setShowAll] = useState(false);
  const PAGE = 40;

  const filtered = useMemo(() => applyControls(rows, controls), [rows, controls]);
  const visible = showAll ? filtered : filtered.slice(0, PAGE);
  const hidden = Math.max(0, filtered.length - visible.length);
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
      <ListControls value={controls} onChange={setControls} idPrefix="verdict-rest" />
      {filtered.length === 0 ? (
        <p className="mt-4 text-sub text-muted-foreground">No wines match those filters.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {visible.map((r) => (
            <ResultRow key={r.key} row={r} onOpen={() => onOpen(r.key)} />
          ))}
          {Array.from({ length: pendingSkeletons }).map((_, i) => (
            <SkeletonRow key={`sk-${i}`} />
          ))}
        </ul>
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
