import { useMemo, useState } from "react";
import type { ScanRow } from "./types";
import { TheCall } from "./TheCall";
import { Alternates } from "./Alternates";
import { pickAlternates } from "./pick-alternates";
import { TheRest } from "./TheRest";
import { ScanDetailSheet } from "./ScanDetailSheet";
import { ScanThumbBar } from "./ScanThumbBar";
import { pickCall, nearTieNote } from "./tiebreak";
import { useLogCallShape } from "./use-log-call-shape";
import { useScanOutcome } from "./use-scan-outcome";
import type { Controls } from "@/lib/list-controls";
import type { CurrencyCode } from "@/lib/currency";

/**
 * The three-layer decision surface. Call → Alternates → collapsed rest.
 * No decimal star score in Layers 1 or 2. Zero nested interactive elements.
 */
export function VerdictSurface({
  rows,
  pendingSkeletons,
  stillReading,
  scannedAt,
  onRescan,
  controls,
  setControls,
  currency,
  scanId,
}: {
  rows: ScanRow[];
  pendingSkeletons: number;
  stillReading: boolean;
  scannedAt: number | null;
  onRescan: () => void;
  controls: Controls;
  setControls: (c: Controls) => void;
  currency?: CurrencyCode;
  /** Present for a persisted scan; enables silent Call-shape instrumentation. */
  scanId?: string | null;
}) {


  const [detailKey, setDetailKey] = useState<string | null>(null);
  // Set when the sheet was opened by an "I ordered this" tap, so it opens in a
  // confirmation state rather than on a rating control.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const closeDetail = () => { setDetailKey(null); setConfirmKey(null); };
  const detailFor = useMemo(
    () => rows.find((r) => r.key === detailKey) ?? null,
    [rows, detailKey],
  );

  const { call, callKind, alternates, restRows, eligible } = useMemo(() => {
    const eligible = rows
      .filter((r) => !r.ranked.vetoed && r.ranked.predicted > 0)
      .sort((a, b) => b.ranked.predicted - a.ranked.predicted);

    if (eligible.length === 0) {
      return { call: null as ScanRow | null, callKind: "your-pick" as const, alternates: [], restRows: rows, eligible };
    }

    // Tie-break lives in ./tiebreak.ts (confidence → value → price, and a
    // missing price abstains rather than sorting as expensive).
    const top = pickCall(eligible)!;

    const kind: "your-pick" | "closest-match" =
      top.ranked.predicted < 4.0 ? "closest-match" : "your-pick";

    const alts = pickAlternates(top, eligible);
    const heroKeys = new Set([top.key, ...alts.map((a) => a.row.key)]);
    const rest = rows.filter((r) => !heroKeys.has(r.key));
    return { call: top, callKind: kind, alternates: alts, restRows: rest, eligible };
  }, [rows]);

  // Rank of the opened wine among eligible candidates — 1 is the Call. Logged
  // with any rating so a miss on the wine we led with is distinguishable from
  // a miss thirty rows down.
  const detailRank = useMemo(() => {
    if (!detailFor) return null;
    if (call && detailFor.key === call.key) return 1;
    const i = eligible.findIndex((r) => r.key === detailFor.key);
    return i >= 0 ? i + 1 : null;
  }, [detailFor, eligible, call]);

  // Instrumentation only — no UI. Tells us after ~20 real scans whether the
  // catalog-first tie-break actually skews the Call upmarket.
  useLogCallShape(call, rows, scanId ?? null);

  // Choice capture. Richer than a star rating — it's a preference over the
  // thirty-nine alternatives we also showed, at their prices. CAPTURE ONLY:
  // nothing in the ranking above reads it.
  const order = useScanOutcome({
    scanId: scanId ?? null,
    call,
    eligible,
    rows,
    onConfirmed: (row) => { setDetailKey(row.key); setConfirmKey(row.key); },
  });



  if (!call) {
    return (
      <div className="mt-6">
        <TheRest
          rows={restRows}
          pendingSkeletons={pendingSkeletons}
          onOpen={setDetailKey}
          stillReading={stillReading}
          currency={currency}
          isOrdered={order.isOrdered}
          onOrdered={order.toggle}
          orderPending={order.pending}
          canOrder={order.enabled}
        />
        <ScanDetailSheet row={detailFor} scannedAt={scannedAt} scanId={scanId ?? null} rank={detailRank} nearTie={detailFor ? nearTieNote(detailFor, eligible) : null} onClose={closeDetail} orderedConfirm={!!detailFor && detailFor.key === confirmKey}
          ordered={!!detailFor && order.isOrdered(detailFor)}
          onOrdered={detailFor ? () => order.toggle(detailFor) : undefined}
          orderPending={order.pending}
          canOrder={order.enabled}
        />

      </div>
    );
  }

  return (
    <div className="scan-decision mt-6 bg-background pb-6">
      <TheCall
        row={call}
        kind={callKind}
        onOpen={() => setDetailKey(call.key)}
        ordered={order.isOrdered(call)}
        onOrdered={() => order.toggle(call)}
        orderPending={order.pending}
        canOrder={order.enabled}
      />
      <Alternates
        items={alternates}
        onOpen={setDetailKey}
        isOrdered={order.isOrdered}
        onOrdered={(a) => order.toggle(a.row)}
        orderPending={order.pending}
        canOrder={order.enabled}
      />
      <TheRest
        rows={restRows}
        pendingSkeletons={pendingSkeletons}
        onOpen={setDetailKey}
        stillReading={stillReading}
        currency={currency}
        isOrdered={order.isOrdered}
        onOrdered={order.toggle}
        orderPending={order.pending}
        canOrder={order.enabled}
      />
      <ScanThumbBar
        onRescan={onRescan}
        controls={controls}
        setControls={setControls}
        currency={currency}
        rows={rows}
      />
      <ScanDetailSheet row={detailFor} scannedAt={scannedAt} scanId={scanId ?? null} rank={detailRank} nearTie={detailFor ? nearTieNote(detailFor, eligible) : null} onClose={closeDetail} orderedConfirm={!!detailFor && detailFor.key === confirmKey}
          ordered={!!detailFor && order.isOrdered(detailFor)}
          onOrdered={detailFor ? () => order.toggle(detailFor) : undefined}
          orderPending={order.pending}
          canOrder={order.enabled}
        />

    </div>
  );
}

