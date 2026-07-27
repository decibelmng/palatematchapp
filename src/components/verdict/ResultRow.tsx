import type { ScanRow } from "./types";
import { priceLabel } from "./types";
import { becauseLine } from "./reason";

/**
 * A row in Layer 3. Real <button>, no nested interactives, no StarTap.
 * The score badge is kept for the enthusiast reading the expanded list.
 */
export function ResultRow({ row, onOpen }: { row: ScanRow; onOpen: () => void }) {
  const r = row.ranked;
  const score = r.predicted > 0 ? r.predicted.toFixed(1) : null;
  const reason = becauseLine(row);
  const price = priceLabel(row);
  const edge = r.vetoed
    ? "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-[--crimson] before:content-['']"
    : r.contested
    ? "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-[--amber] before:content-['']"
    : "";
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Details for ${r.bottle.name}`}
        className={`relative w-full text-left py-4 pl-4 pr-3 flex items-start gap-4 min-h-11 hover:bg-accent/40 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${edge}`}
      >
        <div className="shrink-0 flex flex-col items-center justify-center w-14 h-14 rounded-xl border border-border bg-[--surface-2]">
          {score ? (
            <>
              <span className="font-serif text-[--accent-color] leading-none text-heading">{score}</span>
              <span className="mt-0.5 text-sub text-[--accent-color] leading-none">★</span>
            </>
          ) : (
            <span className="text-label uppercase tracking-label text-muted-foreground">n/a</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {r.vetoed && (
              <span className="shrink-0 mt-0.5 rounded-sm bg-[--crimson] text-white text-label font-bold uppercase tracking-label px-1.5 py-0.5">
                Skip
              </span>
            )}
            <p
              className="text-sub text-foreground break-words leading-snug font-medium"
              style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
            >
              {r.bottle.name}
            </p>
          </div>
          {reason && (
            <p className={`mt-1 text-meta leading-snug ${r.vetoed ? "text-[--crimson]" : "text-muted-foreground"}`}>{reason}</p>
          )}
        </div>
        <div className="shrink-0 text-right pt-1">
          <p className="text-sub text-foreground font-medium">{price}</p>
          {row.greatValue && !r.vetoed && (
            <p className="mt-0.5 flex items-center justify-end gap-1 text-meta text-[--value]">
              <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-[--value]" /> value
            </p>
          )}
        </div>
      </button>
    </li>
  );
}

export function SkeletonRow() {
  return (
    <li className="list-none py-4 pl-4 pr-3 flex items-start gap-4 animate-pulse">
      <div className="shrink-0 w-14 h-14 rounded-xl bg-[--surface-2]" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-3/4 rounded bg-[--surface-2]" />
        <div className="h-3 w-1/3 rounded bg-[--surface-2]" />
        <p className="text-meta text-muted-foreground italic">still reading…</p>
      </div>
      <div className="w-12 h-4 rounded bg-[--surface-2]" />
    </li>
  );
}
