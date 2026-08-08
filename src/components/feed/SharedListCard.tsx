// A list scan — yours, or one a friend explicitly shared. Opening it scores the
// list against the VIEWER's palate, never the sharer's.
import { Link } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import type { SharedListItem } from "@/lib/feed-extras.functions";
import { displayNameFor } from "@/lib/user-display";
import { relativeTime } from "@/lib/feed-reason";
import { FeedCardShell } from "./primitives";
import { RestaurantActions } from "./RestaurantActions";

export function SharedListCard({ item }: { item: SharedListItem }) {
  const venue = item.restaurant?.name ?? "a wine list";
  const who = item.mine ? "You" : item.sharer ? displayNameFor(item.sharer) : "A friend";
  const place = [item.restaurant?.neighborhood, item.restaurant?.city].filter(Boolean).join(" · ");

  return (
    <FeedCardShell accent="list">
      <div className="flex items-start justify-between gap-3">
        <Link to="/scan/$id" params={{ id: item.scan_id }} className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-meta uppercase tracking-label text-muted-foreground">
            <ScrollText size={12} /> {item.mine ? "Your scan" : "Shared list"}
          </div>
          <div className="mt-1 text-sm font-medium leading-snug break-words">
            {who} scanned the list at {venue}
          </div>
          <div className="mt-0.5 text-meta text-muted-foreground">
            {[place, `${item.wine_count} wines`, relativeTime(item.scanned_at)]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <div className="mt-1 text-xs text-foreground">Open it ranked for your palate →</div>
        </Link>
        {item.restaurant && (
          <RestaurantActions
            restaurantId={item.restaurant.id}
            phone={item.restaurant.phone}
            reservationUrl={item.restaurant.reservation_url}
          />
        )}
      </div>
    </FeedCardShell>
  );
}
