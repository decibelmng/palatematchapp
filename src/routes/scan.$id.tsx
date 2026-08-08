import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { AuthGate } from "@/components/AuthGate";
import { loadScanForRanking, shareScan } from "@/lib/scans-history.functions";
import { createOrGetInvite } from "@/lib/invites.functions";
import { useScanRanking } from "@/hooks/use-scan-ranking";
import { VerdictSurface } from "@/components/verdict";
import { applyControls, DEFAULT_CONTROLS, type Controls } from "@/lib/list-controls";
import { storedRowToResolved, currencyOfStoredRows } from "@/lib/scan-row-adapt";
import type { ResolvedWine } from "@/lib/scan.functions";
import { HelpfulPrompt } from "@/components/feedback/HelpfulPrompt";

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
  const nav = useNavigate();
  const load = useServerFn(loadScanForRanking);
  const share = useServerFn(shareScan);
  const invite = useServerFn(createOrGetInvite);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);

  const detail = useQuery({
    queryKey: ["scan-detail", id],
    queryFn: () => load({ data: { scan_id: id } }),
    staleTime: 60_000,
  });

  // Same ranking pipeline the live scanner uses — hooks stay unconditional and
  // simply see an empty list until the query resolves.
  const mappedWines = useMemo<ResolvedWine[]>(
    () => (detail.data?.wines ?? []).map(storedRowToResolved),
    [detail.data],
  );
  const scanCurrency = useMemo(() => currencyOfStoredRows(detail.data?.wines ?? []), [detail.data]);
  const rank = useScanRanking(mappedWines, scanCurrency, null);
  const surfaceRows = useMemo(() => applyControls(rank.allRowsFlat, controls), [rank.allRowsFlat, controls]);

  const shareMut = useMutation({
    mutationFn: async () => share({ data: { scan_id: id } }),
    onSuccess: (r) => {
      const url = `${window.location.origin}/s/${r.share_token}`;
      setShareLink(url);
      try { navigator.clipboard.writeText(url); toast.success("Share link copied"); }
      catch { toast.success("Share link ready"); }
    },
    onError: (e: any) => toast.error(friendlyError(e, "Couldn't share")),
  });

  const inviteMut = useMutation({
    mutationFn: async () => invite({ data: { kind: "scan", scan_id: id } }),
    onSuccess: (r) => {
      const url = `${window.location.origin}/i/${r.token}`;
      setInviteLink(url);
      try { navigator.clipboard.writeText(url); toast.success("Invite link copied"); }
      catch { toast.success("Invite link ready"); }
    },
    onError: (e: any) => toast.error(friendlyError(e, "Couldn't create invite")),
  });

  if (detail.isLoading) return <div className="pt-6 text-sub text-muted-foreground">Loading scan…</div>;
  if (detail.error || !detail.data) return <div className="pt-6 text-sub text-destructive">Couldn't load this scan.</div>;

  const s = detail.data;
  const date = new Date(s.scanned_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const venue = s.restaurant?.name ?? s.venue_raw_text ?? "Unattributed scan";
  const share_token = shareLink ? shareLink.split("/").pop() : s.share_token;

  return (
    <div className="pt-6 space-y-5">
      <header className="space-y-2">
        <div className="text-meta text-muted-foreground">
          <Link to="/scans" className="underline">Past scans</Link> · {date}
        </div>
        <h1 className="font-serif text-title text-foreground leading-tight">{venue}</h1>
        <p className="text-meta text-muted-foreground">
          Facts stored once. This ranking recomputes against your current palate every time you open it.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => shareMut.mutate()}
            disabled={shareMut.isPending}
            className="text-meta px-3 py-1.5 rounded border border-border bg-card hover:bg-accent/40 disabled:opacity-50"
          >
            {share_token ? "Copy share link" : "Share this scan"}
          </button>
          <button
            onClick={() => inviteMut.mutate()}
            disabled={inviteMut.isPending}
            className="text-meta px-3 py-1.5 rounded border border-primary/50 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
            title="Share the list AND auto-connect the recipient as a friend"
          >
            {inviteLink ? "Copy invite link" : "Share as friend invite"}
          </button>
        </div>
        {inviteLink && (
          <div className="text-meta text-muted-foreground break-all">{inviteLink}</div>
        )}
        {share_token && !inviteLink && (
          <div className="text-meta text-muted-foreground break-all">
            {`${typeof window !== "undefined" ? window.location.origin : ""}/s/${share_token}`}
          </div>
        )}
      </header>

      {rank.readable.length > 0 ? (
        <VerdictSurface
          rows={surfaceRows}
          pendingSkeletons={0}
          stillReading={false}
          scannedAt={new Date(s.scanned_at).getTime()}
          onRescan={() => nav({ to: "/scan/list" })}
          controls={controls}
          setControls={setControls}
          currency={rank.currency}
          scanId={s.id}

        />
      ) : (
        <p className="text-sub text-muted-foreground">Couldn't re-read this scan against your palate.</p>
      )}

      <div className="mt-4">
        <HelpfulPrompt
          promptKey="scan.list.ranking"
          question="Did this ranking match what you'd order?"
          context={{ wines_count: s.wines?.length ?? 0, scan_id: id }}
          followUpPlaceholder="Which pick felt off?"
        />
      </div>
    </div>
  );
}
