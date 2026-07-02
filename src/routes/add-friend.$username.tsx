import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { useSendFriendRequest } from "@/hooks/use-friends";

export const Route = createFileRoute("/add-friend/$username")({
  ssr: false,
  head: ({ params }) => ({
    meta: [
      { title: `Add @${params.username} — Palate Match` },
      { name: "description", content: "Send a friend request on Palate Match." },
    ],
  }),
  component: () => <AuthGate><AddFriend /></AuthGate>,
});

function AddFriend() {
  const { username } = Route.useParams();
  const send = useSendFriendRequest();
  const nav = useNavigate();
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    // Auto-send the request once when the page mounts.
    (async () => {
      try {
        const r = await send.mutateAsync({ username });
        setStatus("done");
        setMsg(
          r?.status === "already-friends" ? "You're already friends."
            : r?.status === "already-pending" ? "A request is already pending."
            : r?.status === "resent" ? "Request re-sent."
            : "Request sent."
        );
      } catch (e) {
        setStatus("error");
        setMsg((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  return (
    <div className="pt-8 text-center">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Palate Match invite</p>
      <h1 className="font-serif text-3xl mt-2">Add @{username}</h1>

      <div className="mt-6 rounded-xl border border-border bg-card/60 p-5 max-w-md mx-auto">
        {status === "idle" && <p className="text-sm text-muted-foreground">Sending friend request…</p>}
        {status !== "idle" && (
          <p className={`text-sm ${status === "error" ? "text-destructive" : "text-foreground"}`}>{msg}</p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          <Link to="/friends" className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm">
            Go to Friends
          </Link>
          <button onClick={() => nav({ to: "/" })} className="rounded-md border border-border bg-background px-4 py-2 text-sm">
            Home
          </button>
        </div>
      </div>
    </div>
  );
}
