import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { loadSharedScan } from "@/lib/scans-history.functions";
import { useSession } from "@/hooks/use-session";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { aggregateRated } from "@/lib/cuvee";
import type { RatedFp } from "@/lib/recommender";
import { RankedScanList } from "@/components/RankedScanList";

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
  const load = useServerFn(loadSharedScan);
  const session = useSession();
  const q = useQuery({
    queryKey: ["shared-scan", token],
    queryFn: () => load({ data: { token } }),
    staleTime: 60_000,
  });

  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const ratedRows: RatedFp[] = useMemo(() => {
    if (!ratedBottles || !ratings) return [];
    const raw = ratedBottles.map((b) => ({
      id: b.id, name: b.name, producer: b.producer, region: b.region,
      type: bottleType(b), vintage: b.vintage, fp: bottleToFp(b),
      stars: ratings.find((r) => r.bottle_id === b.id)!.stars,
    }));
    return aggregateRated(raw).map((c) => ({
      id: c.id, name: c.name, producer: c.producer, region: c.region,
      type: c.type, fp: c.fp, stars: c.stars,
    }));
  }, [ratedBottles, ratings]);

  if (q.isLoading) return <div className="pt-6 text-sm text-muted-foreground">Loading…</div>;
  if (!q.data) return <div className="pt-6 text-sm text-muted-foreground">This link is no longer valid.</div>;
  const s = q.data;
  const venue = s.restaurant?.name ?? s.venue_raw_text ?? "Shared wine list";

  return (
    <div className="pt-6 space-y-5 max-w-xl w-full mx-auto px-5 pb-24">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{venue}</h1>
        <p className="text-xs text-muted-foreground">
          Ranked for {session ? "your" : "the viewer's"} palate — never the sharer's.
        </p>
      </header>

      {!session && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <div className="font-medium mb-1">Sign in to rank this list</div>
          <div className="text-muted-foreground mb-3">
            Palate Match ranks every wine against your own taste. Sign in and it'll re-rank for you.
          </div>
          <Link to="/" className="inline-block text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground">
            Open Palate Match
          </Link>
        </div>
      )}

      {session && ratedRows.length < 3 && (
        <div className="text-xs text-muted-foreground p-3 rounded border border-border bg-card">
          Rate a few wines first so we can score this list for you.
        </div>
      )}

      <RankedScanList wines={s.wines} ratedRows={ratedRows} />
    </div>
  );
}
