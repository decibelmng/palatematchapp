import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AuthGate } from "@/components/AuthGate";
import { FeedCard } from "@/components/FeedCard";
import { VenueActivityCard } from "@/components/VenueActivityCard";
import { FounderCard } from "@/components/FounderCard";
import { OwnRatingCard } from "@/components/feed/OwnRatingCard";
import { SharedListCard } from "@/components/feed/SharedListCard";
import { RequestCard, requestIsFeedWorthy } from "@/components/feed/RequestCard";
import { FeedCardShell, WineLine, RateItButton, WishlistIconButton } from "@/components/feed/primitives";
import { useFriendsFeed, useFeedActivity, markFeedSeen } from "@/hooks/use-feed";
import { useMyActivity, useSharedLists } from "@/hooks/use-feed-extras";
import { getVenueActivity, getPaletteOverlapSuggestions } from "@/lib/social-feed.functions";
import { getFriendBottlesOnLists, type FriendBottleOnList } from "@/lib/feed.functions";
import { useFriendships, useSendFriendRequest } from "@/hooks/use-friends";
import { displayNameFor, initialsFor } from "@/lib/user-display";

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: "Feed — Palate Match" },
      { name: "description", content: "Wine lists near you, your own ratings, and what your friends are drinking — all scored for your palate." },
      { property: "og:title", content: "Palate Match — Feed" },
      { property: "og:description", content: "Wine lists, your ratings, and your friends' bottles — scored for your palate." },
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

// ---------- One merged timeline ----------

type Entry =
  | { kind: "friend"; at: string; key: string; node: React.ReactNode }
  | { kind: "own"; at: string; key: string; node: React.ReactNode }
  | { kind: "venue"; at: string; key: string; node: React.ReactNode }
  | { kind: "list"; at: string; key: string; node: React.ReactNode }
  | { kind: "request"; at: string; key: string; node: React.ReactNode };

function FeedContent() {
  const feed = useFriendsFeed(30);
  const mine = useMyActivity(20);
  const lists = useSharedLists(10);
  const activity = useFeedActivity();
  const friendships = useFriendships();

  const venueFn = useServerFn(getVenueActivity);
  const venues = useQuery({
    queryKey: ["venue-activity"],
    queryFn: () => venueFn({ data: { limit: 12 } }),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (activity.data?.latest_at) markFeedSeen(activity.data.latest_at);
  }, [activity.data?.latest_at]);

  const pendingCount = (friendships.data ?? []).filter(
    (f) => f.status === "pending" && f.direction === "incoming",
  ).length;

  const entries: Entry[] = useMemo(() => {
    const out: Entry[] = [];
    for (const it of feed.data ?? []) {
      out.push({ kind: "friend", at: it.created_at, key: `f-${it.rating_id}`, node: <FeedCard item={it} /> });
    }
    for (const it of mine.data ?? []) {
      out.push({ kind: "own", at: it.created_at, key: `m-${it.rating_id}`, node: <OwnRatingCard item={it} /> });
    }
    for (const v of venues.data ?? []) {
      out.push({
        kind: "venue",
        at: `${v.scanned_day}T23:59:59Z`,
        key: `v-${v.restaurant_id}-${v.scanned_day}`,
        node: <VenueActivityCard item={v} />,
      });
    }
    for (const s of lists.data ?? []) {
      out.push({ kind: "list", at: s.scanned_at, key: `l-${s.scan_id}`, node: <SharedListCard item={s} /> });
    }
    for (const r of (friendships.data ?? []).filter((f) => f.status === "pending" && requestIsFeedWorthy(f))) {
      out.push({ kind: "request", at: r.created_at, key: `r-${r.id}`, node: <RequestCard row={r} /> });
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [feed.data, mine.data, venues.data, lists.data, friendships.data]);

  const loading = feed.isLoading || mine.isLoading || venues.isLoading;
  const empty = !loading && entries.length === 0;

  return (
    <div className="pt-4 pb-6">
      {/* Chrome is a single row; the first card below it is always content. */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-serif text-xl">Feed</h1>
        <Link
          to="/friends"
          aria-label={pendingCount > 0 ? `Friends — ${pendingCount} pending` : "Friends"}
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-md border border-border text-muted-foreground"
        >
          <Users size={17} />
          {pendingCount > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-meta font-semibold text-primary-foreground">
              {pendingCount}
            </span>
          )}
        </Link>
      </div>

      <div className="mt-3 space-y-2">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {feed.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {(feed.error as Error).message}
          </div>
        )}
        {entries.map((e) => (
          <div key={e.key}>{e.node}</div>
        ))}
        {empty && <EmptyState />}
      </div>

      <FriendLovesOnLists />
    </div>
  );
}

// ---------- Empty state: suggestions, never synthetic activity ----------

function EmptyState() {
  const fn = useServerFn(getPaletteOverlapSuggestions);
  const q = useQuery({
    queryKey: ["overlap-suggestions"],
    queryFn: () => fn({ data: { limit: 5 } }),
    staleTime: 5 * 60_000,
  });
  const send = useSendFriendRequest();
  const people = q.data ?? [];

  return (
    <div className="space-y-2">
      <FounderCard />
      <FeedCardShell accent="friend">
        <p className="text-sm text-foreground">Quiet for now.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Scan a wine list, or follow someone whose palate sits close to yours.
        </p>
      </FeedCardShell>
      {people.length > 0 && (
        <FeedCardShell accent="friend">
          <p className="text-meta uppercase tracking-label text-muted-foreground">
            Palates close to yours
          </p>
          <ul className="mt-2 divide-y divide-border">
            {people.map((p) => (
              <li key={p.user_id} className="flex items-center gap-3 py-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted font-serif text-xs">
                  {initialsFor({ display_name: p.display_name, username: p.username })}
                </div>
                <Link
                  to="/u/$username"
                  params={{ username: p.username }}
                  className="min-w-0 flex-1 text-sm"
                >
                  <span className="block truncate font-medium">{displayNameFor(p)}</span>
                  <span className="block truncate text-meta text-muted-foreground">
                    @{p.username}
                  </span>
                </Link>
                <button
                  type="button"
                  disabled={send.isPending}
                  onClick={() => send.mutate({ user_id: p.user_id })}
                  className="inline-flex h-11 items-center rounded-md bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50"
                >
                  Follow
                </button>
              </li>
            ))}
          </ul>
        </FeedCardShell>
      )}
    </div>
  );
}

// ---------- Bottles friends love that are on a scanned list ----------

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
    <section className="mt-5 space-y-2">
      <h2 className="text-meta uppercase tracking-label text-muted-foreground">
        Loved by your people — and on a list
      </h2>
      {items.map((it) => <OnListCard key={it.bottle.id} item={it} />)}
    </section>
  );
}

function OnListCard({ item }: { item: FriendBottleOnList }) {
  const { bottle, friends, venues, friendCount } = item;
  const lead = displayNameFor(friends[0]);
  const friendPhrase =
    friendCount === 1 ? lead
    : friendCount === 2 ? `${lead} and 1 other friend`
    : `${lead} and ${friendCount - 1} friends`;
  const venuePhrase = venues.length === 1 ? venues[0] : `${venues[0]} and ${venues.length - 1} more`;

  return (
    <FeedCardShell accent="list">
      <WineLine bottle={bottle} />
      <p className="mt-1.5 text-xs text-muted-foreground">
        {friendPhrase} {friendCount === 1 ? "loves" : "love"} this — it's on the list at {venuePhrase}.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <RateItButton bottleId={bottle.id} />
        <WishlistIconButton bottleId={bottle.id} />
      </div>
    </FeedCardShell>
  );
}
