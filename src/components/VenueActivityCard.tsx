// Venue-first activity: what wine lists were captured, aggregated to the
// (restaurant, day) grain with an attribution floor. No user attribution.
import { Link } from "@tanstack/react-router";
import type { VenueActivityItem } from "@/lib/social-feed.functions";

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
        ? `List updated — ${item.wine_count} wines seen`
        : `${item.delta.newSince} new wines since last visit`;
  return (
    <Link
      to="/scan/$id"
      params={{ id: item.latest_scan_id }}
      className="block rounded-lg border border-border bg-card p-4 hover:bg-accent/40 active:bg-accent/60 transition-colors"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{item.restaurant_name}</div>
          <div className="text-xs text-muted-foreground mt-0.5 truncate">
            {[item.city, relDay(item.scanned_day)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className="shrink-0 text-meta text-muted-foreground">{line}</span>
      </div>
    </Link>
  );
}
