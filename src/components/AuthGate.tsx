import { useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useSession } from "@/hooks/use-session";
import { AppShell } from "./AppShell";

export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();

  if (session === undefined) {
    return (
      <div className="cellar-bg min-h-screen flex items-center justify-center">
        <div className="font-serif text-primary text-lg">·····</div>
      </div>
    );
  }

  if (!session) return <AuthScreen />;
  return <AppShell>{children}</AppShell>;
}

function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const fn = mode === "signin"
        ? supabase.auth.signInWithPassword({ email, password })
        : supabase.auth.signUp({
            email, password,
            options: { emailRedirectTo: window.location.origin },
          });
      const { error } = await fn;
      if (error) throw error;
    } catch (e: any) {
      setErr(e.message ?? "Something went wrong");
    } finally { setBusy(false); }
  }

  return (
    <div className="cellar-bg min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-serif text-4xl text-center">
          Palate <span className="text-primary">Match</span>
        </h1>
        <p className="mt-3 text-center text-sm text-muted-foreground">
          Tap stars. Get your code. Drink better.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-3">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com" autoComplete="email"
            className="w-full rounded-md bg-input border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <input
            type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password" autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="w-full rounded-md bg-input border border-border px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          {err && <p className="text-sm text-destructive">{err}</p>}
          <button
            type="submit" disabled={busy}
            className="w-full rounded-md bg-primary text-primary-foreground py-2.5 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">or</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <button
          type="button"
          onClick={async () => {
            setErr(null);
            const res = await lovable.auth.signInWithOAuth("google", {
              redirect_uri: window.location.origin,
            });
            if (res.error) setErr(res.error.message ?? "Google sign-in failed");
          }}
          className="mt-4 w-full rounded-md border border-border bg-card py-2.5 text-sm font-medium hover:bg-accent flex items-center justify-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5 17.6 35.5 12.5 30.4 12.5 24S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z"/>
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 12.5 24 12.5c2.9 0 5.6 1.1 7.7 2.9l5.7-5.7C33.9 6.5 29.2 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/>
            <path fill="#4CAF50" d="M24 43.5c5.2 0 9.8-2 13.3-5.2l-6.1-5c-2 1.4-4.5 2.2-7.2 2.2-5.3 0-9.7-3.1-11.3-7.4l-6.5 5C9.6 39 16.2 43.5 24 43.5z"/>
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4.1 5.3l6.1 5c-.4.4 6.7-4.9 6.7-14.3 0-1.2-.1-2.4-.4-3.5z"/>
          </svg>
          Continue with Google
        </button>

        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-4 w-full text-xs text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
