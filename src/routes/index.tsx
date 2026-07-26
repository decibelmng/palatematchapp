import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { ScanLine, ArrowRight } from "lucide-react";
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
  const calibrated = count >= UNLOCK_THRESHOLD;
  const remaining = Math.max(0, UNLOCK_THRESHOLD - count);

  // Cold-open routing: first landing this session with no ratings yet? Nudge
  // to Rate so the palate has something to work with. Subsequent visits to
  // "/" still show the scan hero — bottle/list scanning is never gated.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (redirectedRef.current) return;
    if (typeof window === "undefined") return;
    if (!session) return;
    if (calibrated) return;
    try {
      if (sessionStorage.getItem("pm-cold-opened") === "1") return;
      sessionStorage.setItem("pm-cold-opened", "1");
    } catch { /* noop */ }
    redirectedRef.current = true;
    navigate({ to: "/rate" });
  }, [session, calibrated, navigate]);

  const recent = useQuery({
    queryKey: ["recent-scan", "home"],
    queryFn: () => loadRecent(),
    enabled: !!session,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const hasRecent =
    !!(recent.data as { scan?: { id?: string } } | null | undefined)?.scan?.id;

  return (
    <div className="pt-2">
      <Link
        to="/scan/list"
        data-testid="scan-hero"
        className="mt-4 block rounded-[16px] border-2 border-primary/60 bg-gradient-to-br from-primary/15 via-card to-card p-4 shadow-[var(--pm-card-shadow)] hover:border-primary transition"
      >
        <div className="flex items-center gap-3">
          <div className="shrink-0 h-12 w-12 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
            <ScanLine size={24} strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-serif text-heading leading-tight text-foreground">
              Scan a wine list
            </h1>
            <p className="mt-0.5 text-meta text-muted-foreground">
              {hasRecent ? "Resume your last scan →" : "Rank every bottle to your palate."}
            </p>
          </div>
          <ArrowRight className="shrink-0 text-primary" size={18} />
        </div>
      </Link>

      {!calibrated && (
        <div
          className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3"
          data-testid="calibration-note"
        >
          <p className="text-meta text-foreground">
            <span className="font-semibold">Rankings warm up as you rate.</span>{" "}
            <span className="text-muted-foreground">
              {remaining === 1
                ? "One more rating and I can rank any wine list for your taste."
                : `${remaining} more ratings and I can rank any wine list for your taste.`}
            </span>
          </p>
          <div className="mt-2 h-1.5 w-full rounded-full bg-border/70 overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${(count / UNLOCK_THRESHOLD) * 100}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-meta">
            <span className="tabular-nums text-muted-foreground">{count} / {UNLOCK_THRESHOLD} rated</span>
            <Link to="/rate" className="text-primary font-medium inline-flex items-center gap-1">
              Rate wines <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

