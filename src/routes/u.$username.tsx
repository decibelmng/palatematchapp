import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { getPublicProfile } from "@/lib/profile.functions";
import { SommBadge } from "@/components/profile/SommBadge";
import { FollowButton } from "@/components/profile/FollowButton";
import { NameWithHandle } from "@/components/profile/NameWithHandle";
import { useSession } from "@/hooks/use-session";
import { AppShell } from "@/components/AppShell";
import { ChevronLeft } from "lucide-react";

function ProfileFrame({ children, withShell }: { children: ReactNode; withShell: boolean }) {
  if (withShell) return <AppShell>{children}</AppShell>;
  return <>{children}</>;
}

type PublicProfile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  visibility: string;
  somm_status: string;
  somm_role: string | null;
  establishment: string | null;
  palate_code_red: string;
  palate_code_white: string;
  n_rated: number;
  created_at: string;
  follower_count: number;
  following_count: number;
  viewer_follow_status: string;
  is_own: boolean;
};

const profileQueryOptions = (username: string) =>
  queryOptions({
    queryKey: ["public-profile", username],
    queryFn: async () => {
      const row = await getPublicProfile({ data: { username } });
      return (row as PublicProfile | null) ?? null;
    },
    staleTime: 30_000,
  });

export const Route = createFileRoute("/u/$username")({
  loader: async ({ params, context }) => {
    const data = await context.queryClient.ensureQueryData(profileQueryOptions(params.username));
    if (!data) throw notFound();
    return { profile: data };
  },
  head: ({ loaderData }) => {
    const p = loaderData?.profile;
    const name = p?.display_name || p?.username || "Palate Match";
    const codes = p ? `${p.palate_code_red} / ${p.palate_code_white}` : "";
    return {
      meta: [
        { title: `${name} — Palate Match` },
        { name: "description", content: p?.bio || `${name}'s wine palate on Palate Match${codes ? ` — ${codes}` : ""}.` },
        { property: "og:title", content: `${name} — Palate Match` },
        { property: "og:description", content: p?.bio || (codes ? `Palate codes: ${codes}` : "A wine palate on Palate Match.") },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="p-8 text-center">
      <p className="text-sm text-muted-foreground">Profile not found.</p>
      <Link to="/" className="mt-4 inline-block text-sm text-primary">Home</Link>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="p-8 text-center text-sm text-muted-foreground">
      Couldn&apos;t load profile: {error.message}
    </div>
  ),
  component: PublicProfileRoute,
});

function PublicProfileRoute() {
  const { username } = Route.useParams();
  const { data: p } = useSuspenseQuery(profileQueryOptions(username));
  const session = useSession();
  if (!p) return null;

  const isFullView = p.is_own || p.visibility === "public" || p.viewer_follow_status === "accepted";

  return (
    <ProfileFrame withShell={!!session}>
      <div
        className="bg-background max-w-md mx-auto px-4 pb-16"
        style={{ paddingTop: session ? "0.5rem" : "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
      >
        <Link to="/" className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground min-h-11 py-2">
          <ChevronLeft className="h-3 w-3" /> Home
        </Link>

        <div className="mt-4 text-center">
          {p.avatar_url ? (
            <img src={p.avatar_url} alt="" className="mx-auto h-16 w-16 rounded-full object-cover" />
          ) : (
            <div className="mx-auto h-16 w-16 rounded-full bg-muted flex items-center justify-center font-serif text-xl">
              {(p.display_name?.[0] || p.username[0] || "?").toUpperCase()}
            </div>
          )}
          <NameWithHandle
            displayName={p.display_name}
            username={p.username}
            size="lg"
            className="mt-3 inline-flex items-center gap-1 justify-center"
          />

          <div className="mt-2 flex items-center justify-center gap-2">
            <SommBadge status={p.somm_status} role={p.somm_role} establishment={p.establishment} />
          </div>
          {isFullView && p.bio && <p className="mt-3 text-sm text-muted-foreground max-w-sm mx-auto">{p.bio}</p>}
        </div>

        <div className="mt-4 flex items-center justify-center gap-6 text-center">
          <div><div className="font-serif text-lg">{p.follower_count}</div><div className="text-meta uppercase text-muted-foreground" style={{  }}>Followers</div></div>
          <div><div className="font-serif text-lg">{p.following_count}</div><div className="text-meta uppercase text-muted-foreground" style={{  }}>Following</div></div>
          {isFullView && (
            <div><div className="font-serif text-lg">{p.n_rated}</div><div className="text-meta uppercase text-muted-foreground" style={{  }}>Rated</div></div>
          )}
        </div>

        {!p.is_own && session && (
          <div className="mt-5 flex justify-center">
            <FollowButton followeeId={p.id} status={p.viewer_follow_status} />
          </div>
        )}
        {!session && (
          <p className="mt-5 text-center text-meta text-muted-foreground">
            <Link to="/" className="text-primary hover:underline">Sign in</Link> to follow.
          </p>
        )}

        <div className="mt-8 grid grid-cols-2 gap-3">
          <PalateCodeCard label="RED" code={p.palate_code_red} />
          <PalateCodeCard label="WHITE" code={p.palate_code_white} />
        </div>

        {!isFullView && (
          <p className="mt-6 text-center text-meta text-muted-foreground">
            {p.visibility === "private" ? "This profile is private." : "Follow to see the full profile."}
          </p>
        )}
      </div>
    </ProfileFrame>
  );
}

function PalateCodeCard({ label, code }: { label: string; code: string }) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <div className="text-meta uppercase text-muted-foreground" style={{  }}>{label}</div>
      <div className="mt-3 font-serif text-title text-primary" style={{  }}>
        {code.split("").map((ch, i) => (
          <span key={`${label}-${i}`} className={ch === "·" ? "text-muted-foreground/60" : ""}>{ch}</span>
        ))}
      </div>
    </div>
  );
}
