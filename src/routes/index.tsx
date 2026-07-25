import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ScanLine } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useSession } from "@/hooks/use-session";
import { loadRecentScan } from "@/lib/scan.functions";

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
