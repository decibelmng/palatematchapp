import { useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
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
