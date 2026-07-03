import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AuthGate } from "@/components/AuthGate";
import { PalateStar, lettersFromCode } from "@/components/PalateStar";
import { axesFor } from "@/lib/palate";
import {
  useFriendships,
  useUserSearch,
  useMyProfile,
  useSendFriendRequest,
  useRespondFriendship,
  useUpdateProfile,
} from "@/hooks/use-friends";

export const Route = createFileRoute("/friends")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Friends — Palate Match" },
      { name: "description", content: "Add friends and drink together — group your palates for shared bottle picks." },
    ],
  }),
  component: () => <AuthGate><Friends /></AuthGate>,
});

function Friends() {
  const { data: me } = useMyProfile();
  const { data: friendships = [], isLoading } = useFriendships();

  const accepted = friendships.filter((f) => f.status === "accepted");
  const incoming = friendships.filter((f) => f.status === "pending" && f.direction === "incoming");
  const outgoing = friendships.filter((f) => f.status === "pending" && f.direction === "outgoing");

  const inviteURL = useMemo(() => {
    if (!me?.username || typeof window === "undefined") return "";
    return `${window.location.origin}/add-friend/${me.username}`;
  }, [me?.username]);

  return (
    <div className="pt-2 space-y-8">
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Friends</p>
        <h1 className="font-serif text-3xl mt-2">Drink together</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add friends by username or QR — then group your palates on Pour and Scan.
        </p>
      </div>

      {me && <MyProfileCard username={me.username ?? ""} display_name={me.display_name ?? ""} inviteURL={inviteURL} />}

      <FindPeople />

      {incoming.length > 0 && (
        <section>
          <h2 className="font-serif text-lg mb-2">Incoming requests</h2>
          <ul className="divide-y divide-border">
            {incoming.map((f) => <RequestRow key={f.id} row={f} kind="incoming" />)}
          </ul>
        </section>
      )}

      {outgoing.length > 0 && (
        <section>
          <h2 className="font-serif text-lg mb-2">Sent requests</h2>
          <ul className="divide-y divide-border">
            {outgoing.map((f) => <RequestRow key={f.id} row={f} kind="outgoing" />)}
          </ul>
        </section>
      )}

      <section>
        <h2 className="font-serif text-lg mb-2">Your friends</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : accepted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven't added anyone yet. Search above or share your QR code.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {accepted.map((f) => <FriendRow key={f.id} row={f} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

// -------- My profile / QR --------

function MyProfileCard({ username, display_name, inviteURL }: { username: string; display_name: string; inviteURL: string }) {
  const [u, setU] = useState(username);
  const [d, setD] = useState(display_name);
  const [showQR, setShowQR] = useState(false);
  const update = useUpdateProfile();
  const dirty = u !== username || d !== display_name;

  const share = async () => {
    if (typeof window === "undefined") return;
    const nav: any = window.navigator;
    try {
      if (nav && typeof nav.share === "function") {
        await nav.share({ title: "Add me on Palate Match", url: inviteURL });
      } else if (nav?.clipboard) {
        await nav.clipboard.writeText(inviteURL);
        alert("Invite link copied.");
      }
    } catch {/* user cancelled */}
  };

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-muted-foreground">
          Username
          <input
            value={u}
            onChange={(e) => setU(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            maxLength={24}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="lowercase, letters/numbers/_"
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Display name (optional)
          <input
            value={d}
            onChange={(e) => setD(e.target.value)}
            maxLength={60}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="what friends see"
          />
        </label>
      </div>

      {update.error && (
        <p className="mt-2 text-xs text-destructive">{(update.error as Error).message}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          disabled={!dirty || update.isPending || !u}
          onClick={() => update.mutate({ username: u, display_name: d })}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {update.isPending ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setShowQR((v) => !v)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          {showQR ? "Hide QR" : "Show my QR"}
        </button>
        <button
          onClick={share}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        >
          Share invite link
        </button>
        <span className="text-xs text-muted-foreground ml-auto truncate">
          {inviteURL || "Save a username to get your invite link."}
        </span>
      </div>

      {showQR && inviteURL && (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-lg bg-background p-4 border border-border">
          <QRCodeSVG value={inviteURL} size={180} bgColor="#ffffff" fgColor="#000000" />
          <p className="text-[11px] text-muted-foreground">Scan to send me a friend request.</p>
        </div>
      )}
    </div>
  );
}

// -------- Search --------

function FindPeople() {
  const [q, setQ] = useState("");
  const { data: hits = [], isFetching } = useUserSearch(q);
  const send = useSendFriendRequest();

  return (
    <section>
      <h2 className="font-serif text-lg mb-2">Find people</h2>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by username or display name…"
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      {q.trim().length >= 2 && (
        <div className="mt-2">
          {isFetching && <p className="text-xs text-muted-foreground">Searching…</p>}
          {!isFetching && hits.length === 0 && (
            <p className="text-xs text-muted-foreground">No matches.</p>
          )}
          <ul className="divide-y divide-border">
            {hits.map((h) => (
              <li key={h.user_id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{h.display_name || h.username}</p>
                  <p className="text-[11px] text-muted-foreground truncate">@{h.username}</p>
                </div>
                <button
                  onClick={() => send.mutate({ user_id: h.user_id })}
                  disabled={send.isPending}
                  className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs disabled:opacity-50"
                >
                  Add friend
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {send.error && (
        <p className="mt-2 text-xs text-destructive">{(send.error as Error).message}</p>
      )}
    </section>
  );
}

// -------- Requests / friends rows --------

function RequestRow({ row, kind }: { row: import("@/lib/friends.functions").FriendshipRow; kind: "incoming" | "outgoing" }) {
  const respond = useRespondFriendship();
  return (
    <li className="py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{row.other.display_name || row.other.username}</p>
        <p className="text-[11px] text-muted-foreground truncate">@{row.other.username}</p>
      </div>
      <div className="flex gap-2">
        {kind === "incoming" ? (
          <>
            <button
              onClick={() => respond.mutate({ id: row.id, action: "accept" })}
              className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs"
            >
              Accept
            </button>
            <button
              onClick={() => respond.mutate({ id: row.id, action: "decline" })}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
            >
              Decline
            </button>
          </>
        ) : (
          <button
            onClick={() => respond.mutate({ id: row.id, action: "cancel" })}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
        )}
      </div>
    </li>
  );
}

function FriendRow({ row }: { row: import("@/lib/friends.functions").FriendshipRow }) {
  const respond = useRespondFriendship();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{row.other.display_name || row.other.username}</p>
        <p className="text-[11px] text-muted-foreground truncate">@{row.other.username}</p>
        <p className="mt-1 text-[11px] text-muted-foreground font-mono tracking-wider">
          🍷 {row.other.palate_code_red} <span className="opacity-40">·</span> 🥂 {row.other.palate_code_white}
        </p>
      </div>
      <div className="flex gap-2">
        {confirm ? (
          <>
            <button
              onClick={() => respond.mutate({ id: row.id, action: "remove" })}
              className="rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 text-xs"
            >
              Remove
            </button>
            <button
              onClick={() => setConfirm(false)}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}
