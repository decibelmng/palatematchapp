// Shared feed primitives: one compact card shell, one wine title block, and
// one match line. Every wine name here goes through displayWineName /
// wineNameMeta so a card can never repeat the producer or the vintage.
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { displayWineName, wineNameMeta } from "@/lib/wine-name";
import { useAddToWishlist, useRemoveFromWishlist, useWishlistIds } from "@/hooks/use-wishlist";

export type CardAccent = "friend" | "own" | "venue" | "list" | "request";

const ACCENT: Record<CardAccent, string> = {
  friend: "border-l-[3px] border-l-border",
  own: "border-l-[3px] border-l-primary",
  venue: "border-l-[3px] border-l-[color-mix(in_oklab,var(--amber)_60%,transparent)]",
  list: "border-l-[3px] border-l-[color-mix(in_oklab,var(--value)_60%,transparent)]",
  request: "border-l-[3px] border-l-primary",
};

export function FeedCardShell({
  accent,
  children,
}: {
  accent: CardAccent;
  children: ReactNode;
}) {
  return (
    <article className={`pm-card rounded-[12px] p-3 ${ACCENT[accent]}`}>{children}</article>
  );
}

type WineParts = {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  grape: string | null;
  vintage: number | null;
  price_band?: string | null;
};

/** Title + meta, never truncated, never repeating producer or vintage. */
export function WineLine({ bottle }: { bottle: WineParts }) {
  const title = displayWineName(bottle);
  const meta = [
    wineNameMeta(bottle, title),
    bottle.grape,
    bottle.vintage ? String(bottle.vintage) : null,
    bottle.price_band,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link to="/wine/$id" params={{ id: bottle.id }} className="block">
      <div className="text-sm font-medium leading-snug break-words">{title}</div>
      {meta && <div className="mt-0.5 text-meta text-muted-foreground break-words">{meta}</div>}
    </Link>
  );
}

/** One line, only worth showing on a strong match. */
export function MatchLine({ text, strong }: { text: string; strong: boolean }) {
  return (
    <p
      className={`mt-2 text-xs leading-snug ${
        strong
          ? "rounded-md px-2 py-1.5 bg-[color-mix(in_oklab,var(--value)_12%,transparent)] text-foreground"
          : "text-muted-foreground"
      }`}
    >
      {text}
    </p>
  );
}

/** Bookmark icon — the secondary action. "Rate it" stays primary. */
export function WishlistIconButton({ bottleId }: { bottleId: string }) {
  const ids = useWishlistIds();
  const saved = ids.has(bottleId);
  const add = useAddToWishlist();
  const remove = useRemoveFromWishlist();
  const busy = add.isPending || remove.isPending;
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={saved ? "Remove from want to try" : "Want to try"}
      onClick={() => {
        if (saved) remove.mutate({ bottle_id: bottleId });
        else add.mutate({ bottle_id: bottleId, source_context: "feed" });
      }}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-60 ${
        saved ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground"
      }`}
    >
      {saved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
    </button>
  );
}

export function RateItButton({ bottleId, label = "Rate it" }: { bottleId: string; label?: string }) {
  return (
    <Link
      to="/wine/$id"
      params={{ id: bottleId }}
      className="inline-flex h-11 flex-1 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
    >
      {label}
    </Link>
  );
}
