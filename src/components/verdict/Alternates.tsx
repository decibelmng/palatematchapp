import type { Alternate } from "./pick-alternates";
import { priceLabel } from "./types";
import { OrderedButton } from "./OrderedButton";

export function Alternates({
  items, onOpen, orderedBottleId, onOrdered, orderPending, canOrder,
}: {
  items: Alternate[];
  onOpen: (key: string) => void;
  orderedBottleId?: string | null;
  onOrdered?: (a: Alternate) => void;
  orderPending?: boolean;
  canOrder?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {items.map((a) => {
        const ordered = !!orderedBottleId && orderedBottleId === a.row.ranked.bottle.id;
        return (
          // The card's open affordance is an overlay button UNDER the content,
          // so the "I ordered this" control can sit inside the card without
          // nesting one interactive element inside another.
          <div
            key={a.row.key}
            className="relative rounded-xl border border-border bg-card p-4 hover:bg-accent/40"
          >
            <button
              type="button"
              onClick={() => onOpen(a.row.key)}
              aria-label={`${a.label}: ${a.row.ranked.bottle.name}`}
              className="absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            />
            <div className="relative z-10 pointer-events-none text-left">
              <p className="text-label uppercase tracking-label text-muted-foreground">
                {a.label}
              </p>
              <p className="mt-2 font-serif text-heading text-foreground leading-tight break-words">
                {a.row.ranked.bottle.name}
              </p>
              <p className="mt-2 text-sub text-muted-foreground leading-snug">{a.reason}</p>
              <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-sub text-foreground font-medium">{priceLabel(a.row)}</p>
                {canOrder && onOrdered && (
                  <OrderedButton
                    ordered={ordered}
                    disabled={orderPending}
                    size="compact"
                    wineName={a.row.ranked.bottle.name}
                    onToggle={() => onOrdered(a)}
                  />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
