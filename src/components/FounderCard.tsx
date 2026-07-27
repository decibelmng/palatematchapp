// Founder card — opt-in follow (no auto-friending). Renders only if a
// founder row exists AND the viewer has not already followed/befriended.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFounderAccount } from "@/lib/social-feed.functions";
import { useSendFriendRequest, useAcceptedFriends, useFriendships } from "@/hooks/use-friends";
import { displayNameFor, initialsFor } from "@/lib/user-display";

export function FounderCard() {
  const fn = useServerFn(getFounderAccount);
  const q = useQuery({
    queryKey: ["founder-account"],
    queryFn: () => fn(),
    staleTime: 60 * 60_000,
  });
  const send = useSendFriendRequest();
  const friends = useAcceptedFriends();
  const requests = useFriendships();

  const founder = q.data;
  if (!founder) return null;

  // Hide if already befriended or a request exists in either direction.
  const already =
    (friends.data ?? []).some((f) => f.other.user_id === founder.user_id) ||
    (requests.data ?? []).some((r) => r.other.user_id === founder.user_id);
  if (already) return null;

  const name = displayNameFor(founder);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 shrink-0 rounded-full bg-muted flex items-center justify-center font-serif text-sm">
          {initialsFor({ display_name: founder.display_name, username: founder.username })}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              to="/u/$username"
              params={{ username: founder.username }}
              className="font-medium truncate hover:underline"
            >
              {name}
            </Link>
            <span className="text-meta uppercase tracking-label text-primary border border-primary/30 rounded px-1.5 py-0.5">
              Founder
            </span>
          </div>
          {founder.tagline && (
            <p className="mt-1 text-sm text-muted-foreground">{founder.tagline}</p>
          )}
          <button
            type="button"
            onClick={() => send.mutate({ user_id: founder.user_id })}
            disabled={send.isPending}
            className="mt-3 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {send.isPending ? "Following…" : "Follow"}
          </button>
        </div>
      </div>
    </div>
  );
}
