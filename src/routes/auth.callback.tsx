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

// Only allow same-origin, root-relative return paths. Anything else falls
// back to /scan/list — an attacker-controlled `next=` must not become an
// open redirect.
function safeReturnPath(raw: string | null): string {
  if (!raw) return "/scan/list";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/scan/list";
  if (raw.startsWith("/auth/")) return "/scan/list";
  return raw;
}

function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"working" | "timeout" | "error">("working");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    installAuthDebug(supabase);

    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash,
    );
    const providerError =
      params.get("error_description") ||
      params.get("error") ||
      hashParams.get("error_description") ||
      hashParams.get("error");
    const next = safeReturnPath(params.get("next") ?? hashParams.get("next"));

    authTrace("auth callback mount", {
      href: window.location.href,
      hash: window.location.hash,
      search: window.location.search,
      providerError,
      next,
      rawLanding: readRawLanding().slice(-3),
      storage: authStorageSnapshot(),
    });

    // Provider bounced us with an explicit error — no session is coming.
    if (providerError) {
      setStatus("error");
      setDetail(decodeURIComponent(providerError));
      authTrace("auth callback provider error", { providerError });
      return () => {
        cancelled = true;
      };
    }

    const goHome = () => {
      window.clearTimeout(timeout);
      void navigate({ to: next, replace: true });
    };

    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setStatus("timeout");
      authTrace("auth callback timeout", { storage: authStorageSnapshot() });
    }, 10_000);

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      authTrace("auth callback state", {
        event,
        hasSession: !!session,
        userId: session?.user?.id ?? null,
        storage: authStorageSnapshot(),
      });
      if (session && !cancelled) goHome();
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
        goHome();
      } else if (error) {
        window.clearTimeout(timeout);
        setStatus("error");
        setDetail(error.message);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, [navigate]);

  const isWorking = status === "working";
  const heading =
    status === "error"
      ? "Sign-in didn't finish"
      : status === "timeout"
        ? "This is taking longer than expected"
        : "Finishing sign in…";
  const body =
    status === "error"
      ? (detail ?? "The link may have expired or been used already.")
      : status === "timeout"
        ? "The link may have expired, or the sign-in was cancelled. You can try again."
        : "Just a moment.";

  return (
    <main className="cellar-bg min-h-screen flex items-center justify-center px-6">
      <section className="w-full max-w-sm text-center">
        <h1 className="font-serif text-3xl text-primary">Palate Match</h1>
        <p className="mt-4 text-sm text-foreground">{heading}</p>
        <p className="mt-2 text-meta text-muted-foreground">{body}</p>
        {!isWorking && (
          <a
            href="/"
            className="mt-6 inline-block rounded-full border border-border px-5 py-2 text-sm text-foreground hover:bg-surface-2"
          >
            Back to sign in
          </a>
        )}
      </section>
    </main>
  );
}
