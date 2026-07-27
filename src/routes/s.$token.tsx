import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { loadSharedScan } from "@/lib/scans-history.functions";
import { useSession } from "@/hooks/use-session";
import { useScanRanking } from "@/hooks/use-scan-ranking";
import { VerdictSurface } from "@/components/verdict";
import { applyControls, DEFAULT_CONTROLS, type Controls } from "@/lib/list-controls";
import { storedRowToResolved, currencyOfStoredRows } from "@/lib/scan-row-adapt";

export const Route = createFileRoute("/s/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Shared wine list — Palate Match" },
      { name: "description", content: "A shared wine list — ranked for your palate, not the sharer's." },
    ],
  }),
  component: SharedScanPage,
});

function SharedScanPage() {
  const { token } = Route.useParams();
  const nav = useNavigate();
  const load = useServerFn(loadSharedScan);
  const session = useSession();
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);

  const q = useQuery({
    queryKey: ["shared-scan", token],
    queryFn: () => load({ data: { token } }),
    staleTime: 60_000,
  });

  // Same live ranking pipeline as a reopened own-scan; scored against the
  // VIEWER's palate (invariant: a shared scan is never scored for the sharer).
  const mappedWines = useMemo(() => (q.data?.wines ?? []).map(storedRowToResolved), [q.data]);
  const scanCurrency = useMemo(() => currencyOfStoredRows(q.data?.wines ?? []), [q.data]);
  const rank = useScanRanking(mappedWines, scanCurrency, null);
  const surfaceRows = useMemo(() => applyControls(rank.allRowsFlat, controls), [rank.allRowsFlat, controls]);

  if (q.isLoading) return <div className="pt-6 text-sub text-muted-foreground">Loading…</div>;
  if (!q.data) return <div className="pt-6 text-sub text-muted-foreground">This link is no longer valid.</div>;
  const s = q.data;
  const venue = s.restaurant?.name ?? s.venue_raw_text ?? "Shared wine list";

  return (
    <div className="pt-6 space-y-5 max-w-xl w-full mx-auto px-5 pb-24">
      <header className="space-y-2">
        <h1 className="font-serif text-title text-foreground leading-tight">{venue}</h1>
        <p className="text-meta text-muted-foreground">
          Ranked for {session ? "your" : "the viewer's"} palate — never the sharer's.
        </p>
      </header>

      {!session && (
        <div className="rounded-lg border border-border bg-card p-4 text-sub">
          <div className="font-medium mb-1">Sign in to rank this list</div>
          <div className="text-muted-foreground mb-3">
            Palate Match ranks every wine against your own taste. Sign in and it'll re-rank for you.
          </div>
          <Link to="/" className="inline-block text-meta px-3 py-1.5 rounded bg-primary text-primary-foreground">
            Open Palate Match
          </Link>
        </div>
      )}

      {session && !rank.enoughRatings && (
        <div className="text-meta text-muted-foreground p-3 rounded border border-border bg-card">
          Rate a few wines first so we can score this list for you.
        </div>
      )}

      {rank.readable.length > 0 && (
        <VerdictSurface
          rows={surfaceRows}
          pendingSkeletons={0}
          stillReading={false}
          scannedAt={null}
          onRescan={() => nav({ to: "/scan/list" })}
          controls={controls}
          setControls={setControls}
          currency={rank.currency}
        />
      )}
    </div>
  );
}
