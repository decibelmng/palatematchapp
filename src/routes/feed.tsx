import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { FeedCard } from "@/components/FeedCard";
import { useFriendsFeed, useFeedActivity, markFeedSeen } from "@/hooks/use-feed";

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
      <AppShell>
        <FeedContent />
      </AppShell>
    </AuthGate>
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
