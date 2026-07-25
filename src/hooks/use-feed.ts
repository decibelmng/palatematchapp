import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFriendsFeed, getFeedActivity } from "@/lib/feed.functions";
import { useSession } from "./use-session";

export function useFriendsFeed(limit = 30) {
  const session = useSession();
  const fn = useServerFn(getFriendsFeed);
  return useQuery({
    queryKey: ["feed", "friends", session?.user.id ?? null, limit],
    enabled: !!session,
    queryFn: () => fn({ data: { limit } }),
    staleTime: 30_000,
  });
}

/** Timestamp of the newest friend rating — drives the activity dot. */
export function useFeedActivity() {
  const session = useSession();
  const fn = useServerFn(getFeedActivity);
  return useQuery({
    queryKey: ["feed", "activity", session?.user.id ?? null],
    enabled: !!session,
    queryFn: () => fn(),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

const SEEN_KEY = "pm-feed-seen-at";

export function getFeedSeenAt(): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(SEEN_KEY); } catch { return null; }
}

export function markFeedSeen(ts: string | null | undefined) {
  if (typeof window === "undefined" || !ts) return;
  try { localStorage.setItem(SEEN_KEY, ts); } catch { /* noop */ }
}

/** Is there activity since the viewer last opened the feed? */
export function hasFreshActivity(latestAt: string | null | undefined): boolean {
  if (!latestAt) return false;
  const seen = getFeedSeenAt();
  if (!seen) return true;
  return new Date(latestAt).getTime() > new Date(seen).getTime();
}
