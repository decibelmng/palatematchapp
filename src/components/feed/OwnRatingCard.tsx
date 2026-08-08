// Your own activity. Visually distinct: primary left rail, a "You" marker, and
// no match band (you've already tasted it).
import { Link } from "@tanstack/react-router";
import { Crown, Ban, Star } from "lucide-react";
import type { OwnActivityItem } from "@/lib/feed-extras.functions";
import { relativeTime } from "@/lib/feed-reason";
import { FeedCardShell, WineLine } from "./primitives";
import { RatingPhotoButton } from "./RatingPhotoButton";
import { displayWineName } from "@/lib/wine-name";

function Stars({ n }: { n: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${n} stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={12}
          strokeWidth={1.5}
          className={i <= n ? "fill-primary text-primary" : "text-muted-foreground/40"}
        />
      ))}
    </div>
  );
}

export function OwnRatingCard({ item }: { item: OwnActivityItem }) {
  const { bottle } = item;
  return (
    <FeedCardShell accent="own">
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-meta uppercase tracking-label text-primary">
            You
          </span>
          <span className="truncate text-meta text-muted-foreground">
            rated · {relativeTime(item.created_at)}
          </span>
          {item.tier === "canon" && (
            <span className="inline-flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
              <Crown size={11} /> benchmark
            </span>
          )}
          {item.tier === "nemesis" && (
            <span className="inline-flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
              <Ban size={11} /> dealbreaker
            </span>
          )}
        </div>
        <Stars n={item.stars} />
      </header>

      <div className="mt-2 flex gap-3">
        {item.photo_url && (
          <Link to="/wine/$id" params={{ id: bottle.id }} className="shrink-0">
            <img
              src={item.photo_url}
              alt={`Label of ${displayWineName(bottle)}`}
              className="h-16 w-12 rounded-md border border-border object-cover"
              loading="lazy"
            />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <WineLine bottle={bottle} />
        </div>
      </div>

      {item.note && (
        <p className="mt-2 border-l-2 border-border pl-2 text-xs italic text-foreground/90">
          "{item.note}"
        </p>
      )}

      {!item.has_photo && (
        <div className="mt-2">
          <RatingPhotoButton ratingId={item.rating_id} hasPhoto={false} />
        </div>
      )}
    </FeedCardShell>
  );
}
