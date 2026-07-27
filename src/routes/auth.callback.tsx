import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authStorageSnapshot, authTrace, installAuthDebug, readRawLanding } from "@/lib/auth-debug";

export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Finishing sign in — Palate Match" },
      { name: "description", content: "Completing your Palate Match sign-in." },
      { property: "og:title", content: "Finishing sign in — Palate Match" },
      { property: "og:description", content: "Completing your Palate Match sign-in." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("Finishing sign in…");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    installAuthDebug(supabase);
    authTrace("auth callback mount", {
      href: window.location.href,
      hash: window.location.hash,
      search: window.location.search,
      rawLanding: readRawLanding().slice(-3),
      storage: authStorageSnapshot(),
    });

    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setStatus("Still waiting for the sign-in session…");
      setDetail("If this stays here, copy the auth debug trace from the sign-in screen.");
      authTrace("auth callback timeout", { storage: authStorageSnapshot() });
    }, 5000);

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      authTrace("auth callback state", {
        event,
        hasSession: !!session,
        userId: session?.user?.id ?? null,
        storage: authStorageSnapshot(),
      });
      if (session && !cancelled) {
        window.clearTimeout(timeout);
        void navigate({ to: "/scan/list", replace: true });
      }
    });

    supabase.auth.getSession().then(({ data, error }) => {
      authTrace("auth callback getSession", {
        error: error?.message ?? null,
        hasSession: !!data.session,
        userId: data.session?.user?.id ?? null,
        storage: authStorageSnapshot(),
      });
      if (cancelled) return;
      if (data.session) {
        window.clearTimeout(timeout);
        void navigate({ to: "/scan/list", replace: true });
      } else if (error) {
        setStatus("Could not finish sign in.");
        setDetail(error.message);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <main className="cellar-bg min-h-screen flex items-center justify-center px-6">
      <section className="w-full max-w-sm text-center">
        <h1 className="font-serif text-3xl text-primary">Palate Match</h1>
        <p className="mt-4 text-sm text-muted-foreground">{status}</p>
        {detail && <p className="mt-3 text-meta text-muted-foreground">{detail}</p>}
      </section>
    </main>
  );
}