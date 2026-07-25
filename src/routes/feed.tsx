import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { UserPlus, Check, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { FeedCard } from "@/components/FeedCard";
import { useFriendsFeed, useFeedActivity, markFeedSeen } from "@/hooks/use-feed";
import {
  useAcceptedFriends,
  useFriendships,
  useUserSearch,
  useSendFriendRequest,
  useRespondFriendship,
} from "@/hooks/use-friends";
import { displayNameFor, handleForDisplay, initialsFor } from "@/lib/user-display";

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: "Feed — Palate Match" },
      { name: "description", content: "See what your friends are rating, scored for your palate." },
      { property: "og:title", content: "Palate Match — Friends Feed" },
      { property: "og:description", content: "See what your friends are rating, scored for your palate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FeedPage,
});

function FeedPage() {
  return (
    <AuthGate>
      <FeedContent />
    </AuthGate>
  );
}

// Local shims kept for backwards compatibility with existing call sites.
function initials(name: string | null | undefined, username: string) {
  return initialsFor({ display_name: name, username });
}

function FriendsSection() {
  const { data: friends = [] } = useAcceptedFriends();
  const { data: all = [] } = useFriendships();
  const incoming = all.filter((f) => f.status === "pending" && f.direction === "incoming");
  const respond = useRespondFriendship();

  const [q, setQ] = useState("");
  const search = useUserSearch(q);
  const send = useSendFriendRequest();

  return (
    <section aria-labelledby="friends-strip" className="rounded-[14px] border-[0.5px] border-border bg-card/60 p-3">
      <div className="flex items-baseline justify-between">
        <h2 id="friends-strip" className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>
          Friends
        </h2>
        <Link to="/friends" className="text-[11px] text-primary hover:underline">
          Manage →
        </Link>
      </div>

      {/* Inline search */}
      <div className="mt-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find friends by username or name…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {q.trim().length >= 2 && (
          <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-background">
            {search.isFetching && (
              <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>
            )}
            {!search.isFetching && (search.data ?? []).length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No matches.</li>
            )}
            {(search.data ?? []).map((h) => {
              const name = displayNameFor(h);
              const handle = handleForDisplay(h.username);
              return (
                <li key={h.user_id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    {handle && <p className="text-[11px] text-muted-foreground truncate">@{handle}</p>}
                  </div>
                  <button
                    onClick={() => send.mutate({ user_id: h.user_id })}
                    disabled={send.isPending}
                    aria-label={`Add ${name}`}
                    className="shrink-0 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    Add
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-md border border-primary/30 bg-primary/5">
          {incoming.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[10px] uppercase text-primary tracking-wider">Request</p>
                <p className="text-sm font-medium truncate">{displayNameFor(f.other)}</p>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={() => respond.mutate({ id: f.id, action: "accept" })}
                  className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center"
                  aria-label="Accept"
                >
                  <Check size={14} />
                </button>
                <button
                  onClick={() => respond.mutate({ id: f.id, action: "decline" })}
                  className="h-8 w-8 rounded-md border border-border flex items-center justify-center"
                  aria-label="Decline"
                >
                  <X size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Friend avatars strip */}
      <div className="mt-3 flex items-start gap-3 overflow-x-auto pb-1 -mx-1 px-1">
        <Link
          to="/friends"
          aria-label="Find friends"
          className="shrink-0 flex flex-col items-center gap-1.5 w-14"
        >
          <div className="h-12 w-12 rounded-full border border-dashed border-primary/60 text-primary flex items-center justify-center">
            <UserPlus size={18} />
          </div>
          <span className="text-[10px] text-muted-foreground truncate max-w-full">Add</span>
        </Link>
        {friends.map((f) => {
          const name = displayNameFor(f.other);
          return (
            <Link
              key={f.id}
              to="/u/$username"
              params={{ username: f.other.username }}
              className="shrink-0 flex flex-col items-center gap-1.5 w-14"
              aria-label={`Open ${name}'s profile`}
            >
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center font-serif text-sm">
                {initials(f.other.display_name, f.other.username)}
              </div>
              <span className="text-[10px] text-foreground truncate max-w-full">{name}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function FeedContent() {
  const feed = useFriendsFeed(30);
  const activity = useFeedActivity();

  useEffect(() => {
    if (activity.data?.latest_at) markFeedSeen(activity.data.latest_at);
  }, [activity.data?.latest_at]);

  return (
    <div className="pt-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-serif">Feed</h1>
        <Link to="/wishlist" className="text-xs text-muted-foreground hover:text-foreground">
          Wishlist →
        </Link>
      </div>

      <FriendsSection />

      {feed.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : feed.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(feed.error as Error).message}
        </div>
      ) : (feed.data ?? []).length === 0 ? (
        <div className="rounded-lg border border-border bg-card/60 p-6 text-center">
          <p className="text-sm text-foreground">No friend activity yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Add friends above to see wines they've rated, scored for your palate.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(feed.data ?? []).map((item) => (
            <FeedCard key={item.rating_id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
