import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { ScanLine, Lock, ArrowRight } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useSession } from "@/hooks/use-session";
import { loadRecentScan } from "@/lib/scan.functions";
import { useRatingsCount, UNLOCK_THRESHOLD } from "@/components/UnlockMeter";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Scan a wine list — Palate Match" },
      { name: "description", content: "Point your camera at any wine list. We rank every bottle to your palate in seconds." },
      { property: "og:title", content: "Scan a wine list — Palate Match" },
      { property: "og:description", content: "Point your camera at any wine list. We rank every bottle to your palate in seconds." },
    ],
  }),
  component: () => <AuthGate><Home /></AuthGate>,
});

function Home() {
  const session = useSession();
  const loadRecent = useServerFn(loadRecentScan);
  const navigate = useNavigate();
  const count = useRatingsCount();
  const unlocked = count >= UNLOCK_THRESHOLD;
  const remaining = Math.max(0, UNLOCK_THRESHOLD - count);

  // Cold-open routing: if this is the first landing this session and the user
  // is still locked, send them to Rate. Subsequent visits to "/" (e.g. tapping
  // the Scan tab) still show the gate below.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (redirectedRef.current) return;
    if (typeof window === "undefined") return;
    if (!session) return;
    if (unlocked) return;
    try {
      if (sessionStorage.getItem("pm-cold-opened") === "1") return;
      sessionStorage.setItem("pm-cold-opened", "1");
    } catch { /* noop */ }
    redirectedRef.current = true;
    navigate({ to: "/rate" });
  }, [session, unlocked, navigate]);

  const recent = useQuery({
    queryKey: ["recent-scan", "home"],
    queryFn: () => loadRecent(),
    enabled: !!session && unlocked,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const hasRecent =
    !!(recent.data as { scan?: { id?: string } } | null | undefined)?.scan?.id;

  if (!unlocked) {
    return (
      <div className="pt-2">
        <div
          className="mt-4 rounded-[18px] border-2 border-dashed border-primary/50 bg-gradient-to-br from-primary/10 via-card to-card p-6 min-h-[240px]"
          data-testid="scan-locked-gate"
        >
          <div className="flex items-start gap-4">
            <div className="shrink-0 h-16 w-16 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center relative">
              <ScanLine size={36} strokeWidth={1.8} />
              <span className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-background border border-border flex items-center justify-center text-primary">
                <Lock size={14} strokeWidth={2.5} />
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-[10px] uppercase text-primary"
                style={{ letterSpacing: "0.22em" }}
              >
                Almost there
              </p>
              <h1 className="mt-2 font-serif text-[26px] leading-[1.15] text-foreground">
                {remaining === 1 ? "One more to go" : `${remaining} more to go`}
              </h1>
              <p className="mt-2 text-[13px] text-muted-foreground">
                Rate {UNLOCK_THRESHOLD} wines and I'll read any list for you — ranked to your palate in seconds.
              </p>
              <div className="mt-4">
                <div className="h-2 w-full rounded-full bg-border/70 overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${(count / UNLOCK_THRESHOLD) * 100}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
                  {count} / {UNLOCK_THRESHOLD} rated
                </p>
              </div>
            </div>
          </div>
          <Link
            to="/rate"
            className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground w-full"
          >
            Rate wines <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-2">
      <Link
        to="/scan/list"
        data-testid="scan-hero"
        className="mt-4 block rounded-[18px] border-2 border-primary/60 bg-gradient-to-br from-primary/15 via-card to-card p-6 shadow-[var(--pm-card-shadow)] hover:border-primary transition min-h-[240px]"
      >
        <div className="flex items-start gap-4">
          <div className="shrink-0 h-16 w-16 rounded-2xl bg-primary/20 text-primary flex items-center justify-center">
            <ScanLine size={36} strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[10px] uppercase text-primary"
              style={{ letterSpacing: "0.22em" }}
            >
              Get the best bottle
            </p>
            <h1 className="mt-2 font-serif text-[28px] leading-[1.1] text-foreground">
              Scan a wine list
            </h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Point the camera. We'll rank every bottle to your palate in seconds.
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wider text-primary">
              Open camera →
            </span>
            {hasRecent && (
              <p className="mt-4 pt-3 border-t border-border/60 text-[11px] text-muted-foreground">
                Resume your last scan →
              </p>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}
