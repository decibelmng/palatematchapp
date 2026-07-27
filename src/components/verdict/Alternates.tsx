import type { Alternate } from "./pick-alternates";
import { priceLabel } from "./types";

export function Alternates({
  items, onOpen,
}: {
  items: Alternate[];
  onOpen: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map((a) => (
        <button
          key={a.row.key}
          type="button"
          onClick={() => onOpen(a.row.key)}
          aria-label={`${a.label}: ${a.row.ranked.bottle.name}`}
          className="text-left rounded-xl border border-border bg-card p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary hover:bg-accent/40"
        >
          <p className="text-label uppercase tracking-label text-muted-foreground">
            {a.label}
          </p>
          <p className="mt-2 font-serif text-heading text-foreground leading-tight break-words">
            {a.row.ranked.bottle.name}
          </p>
          <p className="mt-2 text-sub text-muted-foreground leading-snug">{a.reason}</p>
          <p className="mt-3 text-sub text-foreground font-medium">{priceLabel(a.row)}</p>
        </button>
      ))}
    </div>
  );
}
