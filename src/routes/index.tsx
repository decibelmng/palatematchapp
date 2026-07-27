import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { ScanLine, ArrowRight, Sparkles } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useSession } from "@/hooks/use-session";
import { loadRecentScan } from "@/lib/scan.functions";
import { useCalibrationState } from "@/hooks/use-calibration";

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
  const { calibrated, provisional } = useCalibrationState();

  // Cold-open routing: no calibration yet → send them into the style quiz.
  // The quiz is zero-recall and takes under a minute; it's a much softer
  // first step than the old "rate 5 wines" search-box gate.
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
    navigate({ to: "/onboarding" });
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
        <Link
          to="/onboarding"
          className="mt-3 block rounded-xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-card p-3"
          data-testid="calibration-note"
        >
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-primary shrink-0" />
            <p className="text-meta font-semibold text-foreground">
              Finish calibration first
            </p>
          </div>
          <p className="mt-1.5 text-meta text-muted-foreground">
            Answer a few taste questions — no wine names — and I can rank any list. <span className="text-primary inline-flex items-center gap-0.5">Start <ArrowRight size={12} /></span>
          </p>
        </Link>
      )}

      {provisional && (
        <div
          className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3"
          data-testid="provisional-note"
        >
          <p className="text-meta text-foreground">
            <span className="font-semibold">Provisional</span>
            <span className="text-muted-foreground"> — based on your style answers. Predictions sharpen with every real rating. </span>
            <Link to="/rate" className="text-primary font-medium inline-flex items-center gap-1">
              Rate a wine <ArrowRight size={12} />
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
