import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { AuthGate } from "@/components/AuthGate";
import { FeedCard } from "@/components/FeedCard";
import { useFriendsFeed, useFeedActivity, markFeedSeen } from "@/hooks/use-feed";
import { useAcceptedFriends } from "@/hooks/use-friends";
import { UserPlus } from "lucide-react";

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
  const s = (name || username || "?").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function FriendsStrip() {
  const { data: friends = [], isLoading } = useAcceptedFriends();
  if (isLoading) return null;
  return (
    <section aria-labelledby="friends-strip" className="rounded-[14px] border-[0.5px] border-border bg-card/60 p-3">
      <div className="flex items-baseline justify-between">
        <h2 id="friends-strip" className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.22em" }}>
          Friends
        </h2>
        <Link to="/friends" className="text-[11px] text-primary hover:underline">
          Find friends →
        </Link>
      </div>
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
          const name = f.other.display_name || f.other.username;
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

  // Opening the feed clears the activity dot.
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

      {/* Friends first — social graph on top, not buried under an empty state. */}
      <FriendsStrip />

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
            Add friends to see wines they've rated, scored for your palate.
          </p>
          <Link
            to="/friends"
            className="mt-4 inline-block rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
          >
            Find friends
          </Link>
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
