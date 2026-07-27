// Empty-feed helper: users with the strongest palate-code overlap. Public
// profiles only. Rendered only when the viewer has no friend activity yet.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPaletteOverlapSuggestions } from "@/lib/social-feed.functions";
import { useSendFriendRequest } from "@/hooks/use-friends";
import { displayNameFor, initialsFor } from "@/lib/user-display";

export function OverlapSuggestions() {
  const fn = useServerFn(getPaletteOverlapSuggestions);
  const q = useQuery({
    queryKey: ["palate-overlap-suggestions"],
    queryFn: () => fn({ data: { limit: 5 } }),
    staleTime: 15 * 60_000,
  });
  const send = useSendFriendRequest();

  const items = q.data ?? [];
  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm font-medium">People with a similar palate</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Public profiles only. Follow to see what they're rating.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {items.map((s) => {
          const name = displayNameFor(s);
          const pct = Math.round(s.overlap * 100);
          return (
            <li key={s.user_id} className="flex items-center gap-3 py-2">
              <div className="h-9 w-9 shrink-0 rounded-full bg-muted flex items-center justify-center font-serif text-xs">
                {initialsFor({ display_name: s.display_name, username: s.username })}
              </div>
              <div className="min-w-0 flex-1">
                <Link
                  to="/u/$username"
                  params={{ username: s.username }}
                  className="text-sm font-medium truncate hover:underline"
                >
                  {name}
                </Link>
                <div className="text-meta text-muted-foreground">{pct}% overlap</div>
              </div>
              <button
                type="button"
                onClick={() => send.mutate({ user_id: s.user_id })}
                disabled={send.isPending}
                className="shrink-0 rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-xs disabled:opacity-50"
              >
                Follow
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
