import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { getInvite, redeemInvite, type InviteInfo } from "@/lib/invites.functions";
import { useSession } from "@/hooks/use-session";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { displayNameFor } from "@/lib/user-display";
import { stashPendingInvite, clearPendingInvite } from "@/lib/pending-invite";
import { InstallGuidance } from "@/components/InstallGuidance";

const CANONICAL_ORIGIN = "https://palatematchapp.com";
const OG_IMAGE = `${CANONICAL_ORIGIN}/og-invite.jpg`;

export const Route = createFileRoute("/i/$token")({
  loader: async ({ params }) => {
    try {
      const inv = await getInvite({ data: { token: params.token } });
      return { invite: inv, token: params.token };
    } catch {
      return { invite: null as InviteInfo | null, token: params.token };
    }
  },
  head: ({ loaderData, params }) => {
    const url = `${CANONICAL_ORIGIN}/i/${params.token}`;
    const inv = loaderData?.invite ?? null;
    const inviter = inv
      ? displayNameFor({ display_name: inv.inviter_display_name, username: inv.inviter_username })
      : null;
    const title = inv
      ? inv.kind === "scan"
        ? `${inviter} shared a wine list — Palate Match`
        : `${inviter} invited you to Palate Match`
      : "You've been invited — Palate Match";
    const description = inv
      ? inv.kind === "scan"
        ? `${inviter} shared a wine list${inv.scan_venue ? ` from ${inv.scan_venue}` : ""}. Open it and see how each bottle scores for your palate.`
        : `${inviter} (Red palate ${inv.inviter_palate_code_red} · White ${inv.inviter_palate_code_white}) wants to compare wine palates on Palate Match.`
      : "A friend invited you to compare wine palates on Palate Match.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { property: "og:image", content: OG_IMAGE },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: OG_IMAGE },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: InvitePage,
});

function InvitePage() {
  const { token, invite } = Route.useLoaderData();
  const session = useSession();
  const nav = useNavigate();
  const redeem = useServerFn(redeemInvite);

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
      toast.error(friendlyError(e, "Couldn't connect"));
    } finally {
      setRedeeming(false);
    }
  };

  const inviter = invite
    ? displayNameFor({ display_name: invite.inviter_display_name, username: invite.inviter_username })
    : "";
  const hook =
    invite?.kind === "scan"
      ? `${inviter} shared a wine list${invite.scan_venue ? ` from ${invite.scan_venue}` : ""}`
      : `${inviter} wants to compare wine palates with you`;

  return (
    <div className="min-h-screen cellar-bg">
      <div className="max-w-md mx-auto px-5 pt-10 pb-16 space-y-6">
        <div className="text-center">
          <p className="text-meta uppercase tracking-label text-muted-foreground">Palate Match invite</p>
          <h1 className="font-serif text-4xl mt-2">
            Palate <span className="text-primary">Match</span>
          </h1>
        </div>

        {!invite && (
          <div className="rounded-xl border border-border bg-card p-5 text-center text-sm">
            This invite link is no longer valid.
            <div className="mt-4">
              <Link to="/" className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs">Open Palate Match</Link>
            </div>
          </div>
        )}

        {invite && (
          <>
            <div className="rounded-xl border border-border bg-card p-5 text-center">
              <div className="text-meta uppercase tracking-label text-muted-foreground">
                {invite.kind === "scan" ? "Shared list" : "Friend invite"}
              </div>
              <div className="mt-2 font-serif text-2xl">{hook}</div>
              <div className="mt-3 flex items-center justify-center gap-3 text-xs text-muted-foreground">
                <span className="rounded-full bg-background border border-border px-2 py-0.5">
                  Red · <span className="font-mono">{invite.inviter_palate_code_red}</span>
                </span>
                <span className="rounded-full bg-background border border-border px-2 py-0.5">
                  White · <span className="font-mono">{invite.inviter_palate_code_white}</span>
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
      redirect_uri: window.location.href,
    });
    if (res.error) setErr(res.error.message ?? `${provider} sign-in failed`);
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo: window.location.href },
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      setErr(friendlyError(e, "Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-sm text-center">
        Check your inbox — we sent a sign-in link. Opening it will connect you automatically.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="text-sm font-medium text-center">Sign in to connect</div>
      <button type="button" onClick={() => oauth("apple")}
        className="w-full rounded-md bg-foreground text-background py-2.5 text-sm font-medium">
        Continue with Apple
      </button>
      <button type="button" onClick={() => oauth("google")}
        className="w-full rounded-md bg-primary text-primary-foreground py-2.5 text-sm font-medium">
        Continue with Google
      </button>
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-meta uppercase tracking-label text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={submitEmail} className="space-y-2">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" autoComplete="email"
          className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm outline-none focus:border-primary" />
        {err && <p className="text-xs text-destructive">{err}</p>}
        <button type="submit" disabled={busy || !email}
          className="w-full rounded-md border border-border bg-card py-2 text-sm disabled:opacity-50">
          {busy ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>
    </div>
  );
}
