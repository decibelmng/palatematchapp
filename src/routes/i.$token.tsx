import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getInvite, redeemInvite } from "@/lib/invites.functions";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { displayNameFor } from "@/lib/user-display";
import { stashPendingInvite, clearPendingInvite } from "@/lib/pending-invite";
import { InstallGuidance } from "@/components/InstallGuidance";

export const Route = createFileRoute("/i/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "You've been invited — Palate Match" },
      { name: "description", content: "A friend invited you to compare wine palates on Palate Match." },
    ],
  }),
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const session = useSession();
  const nav = useNavigate();
  const load = useServerFn(getInvite);
  const redeem = useServerFn(redeemInvite);

  const q = useQuery({
    queryKey: ["invite", token],
    queryFn: () => load({ data: { token } }),
    staleTime: 60_000,
  });

  // Stash the token immediately so signup/OAuth flows can redeem after auth.
  useEffect(() => { stashPendingInvite(token); }, [token]);

  const [redeeming, setRedeeming] = useState(false);
  const [redeemed, setRedeemed] = useState(false);

  const onConnect = async () => {
    if (!session) return;
    setRedeeming(true);
    try {
      const r = await redeem({ data: { token } });
      clearPendingInvite();
      setRedeemed(true);
      toast.success("Connected");
      if (r?.kind === "scan" && r.scan_share_token) {
        nav({ to: "/s/$token", params: { token: r.scan_share_token } });
      } else {
        nav({ to: "/friends" });
      }
    } catch (e) {
      toast.error((e as Error).message ?? "Couldn't connect");
    } finally {
      setRedeeming(false);
    }
  };

  const inv = q.data ?? null;
  const inviter = inv ? displayNameFor({ display_name: inv.inviter_display_name, username: inv.inviter_username }) : "";
  const hook =
    inv?.kind === "scan"
      ? `${inviter} shared a wine list${inv.scan_venue ? ` from ${inv.scan_venue}` : ""}`
      : `${inviter} wants to compare wine palates with you`;

  return (
    <div className="min-h-screen cellar-bg">
      <div className="max-w-md mx-auto px-5 pt-10 pb-16 space-y-6">
        <div className="text-center">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Palate Match invite</p>
          <h1 className="font-serif text-4xl mt-2">
            Palate <span className="text-primary">Match</span>
          </h1>
        </div>

        {q.isLoading && <p className="text-sm text-muted-foreground text-center">Loading invite…</p>}

        {!q.isLoading && !inv && (
          <div className="rounded-xl border border-border bg-card/60 p-5 text-center text-sm">
            This invite link is no longer valid.
            <div className="mt-4">
              <Link to="/" className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs">Open Palate Match</Link>
            </div>
          </div>
        )}

        {inv && (
          <>
            <div className="rounded-xl border border-border bg-card/60 p-5 text-center">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                {inv.kind === "scan" ? "Shared list" : "Friend invite"}
              </div>
              <div className="mt-2 font-serif text-2xl">{hook}</div>
              <div className="mt-3 flex items-center justify-center gap-3 text-xs text-muted-foreground">
                <span className="rounded-full bg-background border border-border px-2 py-0.5">
                  Red · <span className="font-mono">{inv.inviter_palate_code_red}</span>
                </span>
                <span className="rounded-full bg-background border border-border px-2 py-0.5">
                  White · <span className="font-mono">{inv.inviter_palate_code_white}</span>
                </span>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Palate Match rates wines you've had, builds your taste code, then ranks any wine list against you.
              </p>
            </div>

            {session === undefined && (
              <p className="text-xs text-muted-foreground text-center">Checking your session…</p>
            )}

            {session && !redeemed && (
              <button
                type="button"
                onClick={onConnect}
                disabled={redeeming}
                className="w-full rounded-md bg-primary text-primary-foreground py-3 text-sm font-medium disabled:opacity-50"
              >
                {redeeming ? "Connecting…" : `Connect with ${inviter}`}
              </button>
            )}

            {session === null && (
              <>
                <SignInBlock />
                <InstallGuidance />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SignInBlock() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function oauth(provider: "apple" | "google") {
    setErr(null);
    const res = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.href, // return here so the invite redeems on landing
    });
    if (res.error) setErr(res.error.message ?? `${provider} sign-in failed`);
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      // shouldCreateUser: true — link-based invites create accounts on first tap.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.href,
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      setErr((e as Error).message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-center">
        Check your inbox — we sent a sign-in link. Opening it will connect you automatically.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
      <div className="text-sm font-medium text-center">Sign in to connect</div>
      <button
        type="button"
        onClick={() => oauth("apple")}
        className="w-full rounded-md bg-foreground text-background py-2.5 text-sm font-medium"
      >
        Continue with Apple
      </button>
      <button
        type="button"
        onClick={() => oauth("google")}
        className="w-full rounded-md bg-primary text-primary-foreground py-2.5 text-sm font-medium"
      >
        Continue with Google
      </button>
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={submitEmail} className="space-y-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm outline-none focus:border-primary"
        />
        {err && <p className="text-xs text-destructive">{err}</p>}
        <button
          type="submit"
          disabled={busy || !email}
          className="w-full rounded-md border border-border bg-card py-2 text-sm disabled:opacity-50"
        >
          {busy ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
    </div>
  );
}
