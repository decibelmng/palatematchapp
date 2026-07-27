import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { UserPlus, Check, X, Bookmark, BookmarkCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AuthGate } from "@/components/AuthGate";
import { FeedCard } from "@/components/FeedCard";
import { VenueActivityCard } from "@/components/VenueActivityCard";
import { FounderCard } from "@/components/FounderCard";
import { useFriendsFeed, useFeedActivity, markFeedSeen } from "@/hooks/use-feed";
import { getVenueActivity } from "@/lib/social-feed.functions";
import { getFriendBottlesOnLists, type FriendBottleOnList } from "@/lib/feed.functions";
import { useAddToWishlist, useRemoveFromWishlist, useWishlistIds } from "@/hooks/use-wishlist";
import {
  useAcceptedFriends,
  useFriendships,
  useUserSearch,
  useSendFriendRequest,
  useRespondFriendship,
} from "@/hooks/use-friends";
import { NameWithHandle } from "@/components/profile/NameWithHandle";
import { displayNameFor, handleForDisplay, initialsFor } from "@/lib/user-display";
import type { FriendshipRow } from "@/lib/friends.functions";

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

function initials(name: string | null | undefined, username: string) {
  return initialsFor({ display_name: name, username });
}

// ---------- Requests block ----------

function IncomingRow({ row }: { row: FriendshipRow }) {
  const respond = useRespondFriendship();
  const name = displayNameFor(row.other);
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center font-serif text-sm">
        {initials(row.other.display_name, row.other.username)}
      </div>
      <div className="min-w-0 flex-1">
        <NameWithHandle displayName={row.other.display_name} username={row.other.username} size="sm" />
        <p className="mt-0.5 text-meta text-muted-foreground font-mono tracking-label">
          🍷 {row.other.palate_code_red} <span className="opacity-40">·</span> 🥂 {row.other.palate_code_white}
        </p>
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={() => respond.mutate({ id: row.id, action: "accept" })}
          disabled={respond.isPending}
          aria-label={`Accept request from ${name}`}
          className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs disabled:opacity-50"
        >
          <Check size={13} /> Accept
        </button>
        <button
          onClick={() => respond.mutate({ id: row.id, action: "decline" })}
          disabled={respond.isPending}
          aria-label={`Decline request from ${name}`}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs disabled:opacity-50"
        >
          <X size={13} /> Decline
        </button>
      </div>
    </li>
  );
}

function OutgoingRow({ row }: { row: FriendshipRow }) {
  const respond = useRespondFriendship();
  const name = displayNameFor(row.other);
  return (
    <li className="flex items-center gap-3 px-3 py-3">
      <div className="h-10 w-10 shrink-0 rounded-full bg-muted flex items-center justify-center font-serif text-sm">
        {initials(row.other.display_name, row.other.username)}
      </div>
      <div className="min-w-0 flex-1">
        <NameWithHandle displayName={row.other.display_name} username={row.other.username} size="sm" />
        <p className="mt-0.5 text-meta uppercase tracking-label text-muted-foreground">Requested</p>
      </div>
      <button
        onClick={() => respond.mutate({ id: row.id, action: "cancel" })}
        disabled={respond.isPending}
        aria-label={`Cancel request to ${name}`}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        Cancel
      </button>
    </li>
  );
}

function FriendsSection() {
  const { data: friends = [] } = useAcceptedFriends();
  const { data: all = [] } = useFriendships();
  const incoming = all.filter((f) => f.status === "pending" && f.direction === "incoming");
  const outgoing = all.filter((f) => f.status === "pending" && f.direction === "outgoing");

  const [q, setQ] = useState("");
  const search = useUserSearch(q);
  const send = useSendFriendRequest();

  return (
    <section aria-labelledby="friends-strip" className="rounded-[14px] border border-border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <h2 id="friends-strip" className="text-meta uppercase text-muted-foreground" style={{  }}>
          Friends
        </h2>
        <Link to="/friends" className="text-meta text-primary hover:underline">
          Manage →
        </Link>
      </div>

      {/* Requests — incoming first (loudest), then outgoing */}
      {incoming.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-meta uppercase tracking-label text-primary">Requests</span>
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-primary-foreground px-1 text-meta font-semibold">
              {incoming.length}
            </span>
          </div>
          <ul className="divide-y divide-border rounded-md border border-primary/40 bg-primary/5">
            {incoming.map((f) => <IncomingRow key={f.id} row={f} />)}
          </ul>
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="mt-3">
          <div className="text-meta uppercase tracking-label text-muted-foreground mb-1.5">
            Sent
          </div>
          <ul className="divide-y divide-border rounded-md border border-border bg-background">
            {outgoing.map((f) => <OutgoingRow key={f.id} row={f} />)}
          </ul>
        </div>
      )}

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
                    {handle && <p className="text-meta text-muted-foreground truncate">@{handle}</p>}
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
          <span className="text-meta text-muted-foreground truncate max-w-full">Add</span>
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
              <span className="text-meta text-foreground truncate max-w-full">{name}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function VenueActivitySection() {
  const fn = useServerFn(getVenueActivity);
  const q = useQuery({
    queryKey: ["venue-activity"],
    queryFn: () => fn({ data: { limit: 12 } }),
    staleTime: 60_000,
  });
  const items = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Wine lists nearby</h2>
      <div className="space-y-2">
        {items.map((v) => (
          <VenueActivityCard key={`${v.restaurant_id}-${v.scanned_day}`} item={v} />
        ))}
      </div>
    </section>
  );
}

/** ⭐ The nearby-list join: bottles friends love that are on a recently-scanned
 *  venue list. No geolocation exists, so copy never claims distance. */
function FriendLovesOnLists() {
  const fn = useServerFn(getFriendBottlesOnLists);
  const q = useQuery({
    queryKey: ["friend-bottles-on-lists"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
  const items = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Your people love these — and they're on a list</h2>
      <div className="space-y-3">
        {items.map((it) => <OnListCard key={it.bottle.id} item={it} />)}
      </div>
    </section>
  );
}

function OnListCard({ item }: { item: FriendBottleOnList }) {
  const { bottle, friends, venues, friendCount } = item;
  const wishIds = useWishlistIds();
  const inWishlist = wishIds.has(bottle.id);
  const add = useAddToWishlist();
  const remove = useRemoveFromWishlist();
  const busy = add.isPending || remove.isPending;

  const lead = displayNameFor(friends[0]);
  const friendPhrase =
    friendCount === 1 ? lead
    : friendCount === 2 ? `${lead} and 1 other friend`
    : `${lead} and ${friendCount - 1} friends`;
  const venuePhrase = venues.length === 1 ? venues[0] : `${venues[0]} and ${venues.length - 1} more`;

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <Link to="/wine/$id" params={{ id: bottle.id }} className="block">
        <div className="text-base font-medium leading-snug line-clamp-2">
          {bottle.producer ? `${bottle.producer} · ` : ""}{bottle.name}{bottle.vintage ? ` ${bottle.vintage}` : ""}
        </div>
        {(bottle.region || bottle.grape) && (
          <div className="mt-0.5 text-xs text-muted-foreground truncate">
            {[bottle.grape, bottle.region].filter(Boolean).join(" · ")}
          </div>
        )}
      </Link>
      <p className="mt-2 text-sm text-foreground">
        {friendPhrase} {friendCount === 1 ? "loves" : "love"} this — and it's on the list at {venuePhrase}.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (inWishlist) remove.mutate({ bottle_id: bottle.id });
            else add.mutate({ bottle_id: bottle.id, source_context: "feed" });
          }}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
            inWishlist ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background hover:bg-accent"
          }`}
        >
          {inWishlist ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          {inWishlist ? "Saved" : "Want to try"}
        </button>
        <Link
          to="/wine/$id"
          params={{ id: bottle.id }}
          className="flex-1 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium"
        >
          See it
        </Link>
      </div>
    </article>
  );
}

function FeedContent() {
  const feed = useFriendsFeed(30);
  const activity = useFeedActivity();

  useEffect(() => {
    if (activity.data?.latest_at) markFeedSeen(activity.data.latest_at);
  }, [activity.data?.latest_at]);

  const empty = !feed.isLoading && !feed.error && (feed.data ?? []).length === 0;

  return (
    <div className="pt-5 space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-serif">Feed</h1>
        <Link to="/wishlist" className="text-xs text-muted-foreground hover:text-foreground">
          Wishlist →
        </Link>
      </div>

      <FriendLovesOnLists />

      <VenueActivitySection />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Friends</h2>
        <FriendsSection />

        {feed.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : feed.error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {(feed.error as Error).message}
          </div>
        ) : empty ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-6 text-center">
              <p className="text-sm text-foreground">No friend activity yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add friends above to see wines they've rated, scored for your palate.
              </p>
            </div>
            <FounderCard />
          </div>
        ) : (
          <div className="space-y-3">
            {(feed.data ?? []).map((item) => (
              <FeedCard key={item.rating_id} item={item} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
