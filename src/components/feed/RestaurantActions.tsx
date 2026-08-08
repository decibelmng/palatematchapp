// A restaurant as an object you can act on: save it, call it, book it.
import { Bookmark, BookmarkCheck, Phone, CalendarCheck } from "lucide-react";
import { useSavedRestaurants, useToggleSavedRestaurant } from "@/hooks/use-feed-extras";

export function RestaurantActions({
  restaurantId,
  phone,
  reservationUrl,
}: {
  restaurantId: string;
  phone?: string | null;
  reservationUrl?: string | null;
}) {
  const saved = useSavedRestaurants();
  const toggle = useToggleSavedRestaurant();
  const isSaved = (saved.data ?? []).some((r) => r.restaurant_id === restaurantId);

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        disabled={toggle.isPending}
        aria-label={isSaved ? "Remove from want to go" : "Save to want to go"}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle.mutate({ restaurant_id: restaurantId, saved: !isSaved });
        }}
        className={`inline-flex h-11 w-11 items-center justify-center rounded-md border transition-colors disabled:opacity-60 ${
          isSaved ? "border-primary/50 bg-primary/10 text-primary" : "border-border text-muted-foreground"
        }`}
      >
        {isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
      </button>
      {phone && (
        <a
          href={`tel:${phone.replace(/[^+0-9]/g, "")}`}
          onClick={(e) => e.stopPropagation()}
          aria-label="Call the restaurant"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border text-muted-foreground"
        >
          <Phone size={16} />
        </a>
      )}
      {reservationUrl && (
        <a
          href={reservationUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(e) => e.stopPropagation()}
          aria-label="Book a table"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border text-muted-foreground"
        >
          <CalendarCheck size={16} />
        </a>
      )}
    </div>
  );
}
