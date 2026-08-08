// Venue-first activity: what wine lists were captured, aggregated to the
// (restaurant, day) grain with an attribution floor. Never names or implies who
// scanned it — no user, no avatar, no count of scanners.
import { Link } from "@tanstack/react-router";
import { Wine } from "lucide-react";
import type { VenueActivityItem } from "@/lib/social-feed.functions";
import { FeedCardShell } from "./feed/primitives";
import { RestaurantActions } from "./feed/RestaurantActions";

function relDay(iso: string): string {
  const day = new Date(iso + "T12:00:00Z");
  const now = new Date();
  const diff = Math.round((now.getTime() - day.getTime()) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return `${diff} days ago`;
  return day.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function VenueActivityCard({ item }: { item: VenueActivityItem }) {
  const line =
    item.delta === "first-time"
      ? `New list — ${item.wine_count} wines`
      : item.delta === "updated"
        ? `List updated — ${item.wine_count} wines`
        : `${item.delta.newSince} new wines since last time`;
  const place = [item.neighborhood, item.city].filter(Boolean).join(" · ");

  return (
    <FeedCardShell accent="venue">
      <div className="flex items-start justify-between gap-3">
        <Link to="/scan/$id" params={{ id: item.latest_scan_id }} className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-meta uppercase tracking-label text-muted-foreground">
            <Wine size={12} /> Wine list
          </div>
          <div className="mt-1 text-sm font-medium leading-snug break-words">
            {item.restaurant_name}
          </div>
          <div className="mt-0.5 text-meta text-muted-foreground">
            {[line, place, relDay(item.scanned_day)].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-1 text-xs text-foreground">See it ranked for your palate →</div>
        </Link>
        <RestaurantActions
          restaurantId={item.restaurant_id}
          phone={item.phone}
          reservationUrl={item.reservation_url}
        />
      </div>
    </FeedCardShell>
  );
}
