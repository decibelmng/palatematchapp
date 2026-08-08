// A friend request as an ordinary feed card. Incoming always shows; outgoing
// only while it is still news (7 days), after which it lives on /friends.
import { Check, X, Clock } from "lucide-react";
import { NameWithHandle } from "@/components/profile/NameWithHandle";
import { displayNameFor, initialsFor } from "@/lib/user-display";
import { useRespondFriendship } from "@/hooks/use-friends";
import { relativeTime } from "@/lib/feed-reason";
import type { FriendshipRow } from "@/lib/friends.functions";
import { FeedCardShell } from "./primitives";

export const REQUEST_FEED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Outgoing requests older than a week are not news. */
export function requestIsFeedWorthy(row: FriendshipRow): boolean {
  if (row.direction === "incoming") return true;
  const at = new Date(row.created_at).getTime();
  return Number.isFinite(at) && Date.now() - at < REQUEST_FEED_MAX_AGE_MS;
}

export function RequestCard({ row }: { row: FriendshipRow }) {
  const respond = useRespondFriendship();
  const name = displayNameFor(row.other);
  const incoming = row.direction === "incoming";

  return (
    <FeedCardShell accent="request">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted font-serif text-sm">
          {initialsFor({ display_name: row.other.display_name, username: row.other.username })}
        </div>
        <div className="min-w-0 flex-1">
          <NameWithHandle
            displayName={row.other.display_name}
            username={row.other.username}
            size="sm"
          />
          <p className="mt-0.5 text-meta text-muted-foreground">
            {incoming ? "sent you a request" : "request sent"} · {relativeTime(row.created_at)}
          </p>
        </div>
        {incoming ? (
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={() => respond.mutate({ id: row.id, action: "accept" })}
              disabled={respond.isPending}
              aria-label={`Accept request from ${name}`}
              className="inline-flex h-11 items-center gap-1 rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50"
            >
              <Check size={13} /> Accept
            </button>
            <button
              onClick={() => respond.mutate({ id: row.id, action: "decline" })}
              disabled={respond.isPending}
              aria-label={`Decline request from ${name}`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-border text-muted-foreground disabled:opacity-50"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
            <Clock size={12} /> waiting
          </span>
        )}
      </div>
    </FeedCardShell>
  );
}
