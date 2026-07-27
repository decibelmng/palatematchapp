import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useSession } from "@/hooks/use-session";
import { authStorageSnapshot, authTrace, clearAuthTrace, getAuthGateMountCount, installAuthDebug, readAuthTrace, registerAuthGateMount } from "@/lib/auth-debug";
import { AppShell } from "./AppShell";
import { NameGate } from "./NameGate";

export function AuthGate({ children }: { children: ReactNode }) {
  const mountId = useRef(0);
  if (typeof window !== "undefined" && mountId.current === 0) {
    installAuthDebug(supabase);
    mountId.current = registerAuthGateMount();
  }
  const session = useSession();
  useEffect(() => () => {
    authTrace("AuthGate unmount", {
      mountId: mountId.current,
      totalMountsSeen: getAuthGateMountCount(),
      storage: authStorageSnapshot(),
    });
  }, []);
  authTrace("AuthGate render", {
    mountId: mountId.current,
    totalMountsSeen: getAuthGateMountCount(),
    state: session === undefined ? "loading" : session ? "signed-in" : "signed-out",
    origin: typeof window !== "undefined" ? window.location.origin : "ssr",
    path: typeof window !== "undefined" ? window.location.pathname : "ssr",
    storage: authStorageSnapshot(),
    decision: session === undefined ? "loading" : session ? "app" : "login",
  });

  if (session === undefined) {
    return (
      <div className="cellar-bg min-h-screen flex items-center justify-center">
        <div className="font-serif text-primary text-lg">·····</div>
      </div>
    );
  }

  if (!session) return <AuthScreen />;
  return (
    <NameGate>
      <AppShell>{children}</AppShell>
    </NameGate>
  );
}

type Mode = "login" | "recover" | "create";

function AuthScreen() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const NEUTRAL =
    "If that email is set up for Palate Match, we've sent a sign-in link. Check your inbox — and your spam folder.";

  async function oauth(provider: "apple" | "google") {
    setErr(null);
    installAuthDebug(supabase);
    authTrace("oauth click", {
      provider,
      origin: window.location.origin,
      redirect_uri: window.location.origin,
      href: window.location.href,
      storage: authStorageSnapshot(),
    });
    const res = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin,
    });
    authTrace("oauth result", {
      redirected: (res as any)?.redirected,
      hasTokens: !!(res as any)?.tokens,
      error: (res as any)?.error?.message ?? null,
      storage: authStorageSnapshot(),
    });
    if (res.error) {
      const message = res.error.message ?? `${provider} sign-in failed`;
      toast.error(message);
    }
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (mode === "create") {
        const trimmed = displayName.trim();
        if (trimmed.length < 1) throw new Error("Please enter your name.");
        if (trimmed.length > 60) throw new Error("Name must be under 60 characters.");
        // Stash the name so NameGate can pre-fill / apply it after the magic link.
        try { localStorage.setItem("pm.pendingDisplayName", trimmed); } catch { /* ignore */ }
        // Explicit account creation — only happens from the Create screen.
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: true,
            emailRedirectTo: window.location.origin,
            data: { display_name: trimmed },
          },
        });
        if (error) throw error;
      } else {
        // Login + Recover: never auto-create. Same neutral UX for both known
        // and unknown emails so we don't leak who has an account.
        await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: false,
            emailRedirectTo: window.location.origin,
          },
        });
        // Ignore the error deliberately — identical response either way.
      }
      setSent(true);
    } catch (e: any) {
      setErr(e?.message ?? "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <ScreenShell>
        <h1 className="font-serif text-3xl text-center">Check your inbox</h1>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          {mode === "create"
            ? "We've sent a link to confirm your new account."
            : NEUTRAL}
        </p>
        <button
          onClick={() => {
            setSent(false);
            setEmail("");
            setMode("login");
          }}
          className="mt-8 w-full text-xs text-muted-foreground hover:text-foreground"
        >
          Back
        </button>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <h1 className="font-serif text-4xl text-center">
        Palate <span className="text-primary">Match</span>
      </h1>
      <p className="mt-3 text-center text-sm text-muted-foreground">
        {mode === "create"
          ? "Create a new account"
          : mode === "recover"
            ? "Find your account"
            : "Rate wines. Get your code. Drink better."}
      </p>

      {mode === "login" && (
        <div className="mt-8 space-y-3">
          <button
            type="button"
            onClick={() => oauth("apple")}
            className="w-full rounded-md bg-foreground text-background py-2.5 text-sm font-medium hover:opacity-90 flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.05 12.5c-.03-2.86 2.34-4.24 2.45-4.31-1.34-1.96-3.42-2.23-4.16-2.26-1.77-.18-3.46 1.04-4.36 1.04-.91 0-2.29-1.02-3.77-.99-1.94.03-3.73 1.13-4.73 2.86-2.02 3.5-.52 8.68 1.45 11.53.96 1.39 2.1 2.96 3.58 2.91 1.44-.06 1.99-.94 3.73-.94s2.23.94 3.75.91c1.55-.03 2.53-1.42 3.48-2.82 1.1-1.61 1.55-3.18 1.57-3.26-.03-.02-3.01-1.16-3.04-4.57zM14.34 4.03c.79-.96 1.32-2.29 1.18-3.62-1.14.05-2.53.76-3.35 1.71-.73.85-1.37 2.21-1.2 3.51 1.27.1 2.57-.65 3.37-1.6z"/>
            </svg>
            Continue with Apple
          </button>
          <button
            type="button"
            onClick={() => oauth("google")}
            className="w-full rounded-md bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:opacity-90 flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5 17.6 35.5 12.5 30.4 12.5 24S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"/>
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
              <path fill="#4CAF50" d="M24 43.5c5.2 0 9.8-2 13.3-5.2l-6.1-5c-2 1.4-4.5 2.2-7.2 2.2-5.3 0-9.7-3.1-11.3-7.4l-6.5 5C9.6 39 16.2 43.5 24 43.5z"/>
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4.1 5.3l6.1 5c-.4.4 6.7-4.9 6.7-14.3 0-1.2-.1-2.4-.4-3.5z"/>
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 pt-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-meta uppercase tracking-label text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}

      <form onSubmit={submitEmail} className="mt-4 space-y-3">
        {mode === "create" && (
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            maxLength={60}
            className="w-full rounded-md bg-input border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        )}
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className="w-full rounded-md bg-input border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        {err && <p className="text-sm text-destructive">{err}</p>}
        <button
          type="submit"
          disabled={busy || !email || (mode === "create" && !displayName.trim())}
          className="w-full rounded-md border border-border bg-card py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {busy
            ? "…"
            : mode === "create"
              ? "Create account"
              : mode === "recover"
                ? "Send recovery link"
                : "Continue with email"}
        </button>
      </form>

      <div className="mt-6 flex flex-col items-center gap-2 text-xs text-muted-foreground">
        {mode === "login" && (
          <>
            <button onClick={() => { setErr(null); setMode("recover"); }} className="hover:text-foreground">
              Find my account
            </button>
            <button onClick={() => { setErr(null); setMode("create"); }} className="hover:text-foreground">
              New here? Create an account
            </button>
          </>
        )}
        {mode !== "login" && (
          <button onClick={() => { setErr(null); setMode("login"); }} className="hover:text-foreground">
            Back to sign in
          </button>
        )}
      </div>
    </ScreenShell>
  );
}

function ScreenShell({ children }: { children: ReactNode }) {
  return (
    <div className="cellar-bg min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
