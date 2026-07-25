import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AuthGate } from "@/components/AuthGate";
import { loadScanForRanking, shareScan } from "@/lib/scans-history.functions";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { aggregateRated } from "@/lib/cuvee";
import type { RatedFp } from "@/lib/recommender";
import { RankedScanList } from "@/components/RankedScanList";

export const Route = createFileRoute("/scan/$id")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Scan — Palate Match" },
      { name: "description", content: "A saved wine list, re-ranked against your current palate." },
    ],
  }),
  component: () => <AuthGate><ScanDetailPage /></AuthGate>,
});

function ScanDetailPage() {
  const { id } = Route.useParams();
  const load = useServerFn(loadScanForRanking);
  const share = useServerFn(shareScan);
  const [shareLink, setShareLink] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["scan-detail", id],
    queryFn: () => load({ data: { scan_id: id } }),
    staleTime: 60_000,
  });

  const shareMut = useMutation({
    mutationFn: async () => share({ data: { scan_id: id } }),
    onSuccess: (r) => {
      const url = `${window.location.origin}/s/${r.share_token}`;
      setShareLink(url);
      try { navigator.clipboard.writeText(url); toast.success("Share link copied"); }
      catch { toast.success("Share link ready"); }
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't share"),
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

  if (detail.isLoading) return <div className="pt-6 text-sm text-muted-foreground">Loading scan…</div>;
  if (detail.error || !detail.data) return <div className="pt-6 text-sm text-destructive">Couldn't load this scan.</div>;

  const s = detail.data;
  const date = new Date(s.scanned_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const venue = s.restaurant?.name ?? s.venue_raw_text ?? "Unattributed scan";
  const share_token = shareLink ? shareLink.split("/").pop() : s.share_token;

  return (
    <div className="pt-6 space-y-5">
      <header className="space-y-2">
        <div className="text-xs text-muted-foreground">
          <Link to="/scans" className="underline">Past scans</Link> · {date}
        </div>
        <h1 className="text-2xl font-semibold">{venue}</h1>
        <p className="text-xs text-muted-foreground">
          Facts stored once. This ranking recomputes against your current palate every time you open it.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => shareMut.mutate()}
            disabled={shareMut.isPending}
            className="text-xs px-3 py-1.5 rounded border border-border bg-card hover:bg-accent/40 disabled:opacity-50"
          >
            {share_token ? "Copy share link" : "Share this scan"}
          </button>
        </div>
        {share_token && (
          <div className="text-[11px] text-muted-foreground break-all">
            {`${typeof window !== "undefined" ? window.location.origin : ""}/s/${share_token}`}
          </div>
        )}
      </header>

      <RankedScanList wines={s.wines} ratedRows={ratedRows} />
    </div>
  );
}
