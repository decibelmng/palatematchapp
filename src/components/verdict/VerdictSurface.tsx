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

  // Instrumentation only — no UI. Tells us after ~20 real scans whether the
  // catalog-first tie-break actually skews the Call upmarket.
  useLogCallShape(call, rows, scanId ?? null);


  if (!call) {
    return (
      <div className="mt-6">
        <TheRest
          rows={restRows}
          pendingSkeletons={pendingSkeletons}
          onOpen={setDetailKey}
          stillReading={stillReading}
          currency={currency}
        />
        <ScanDetailSheet row={detailFor} scannedAt={scannedAt} scanId={scanId ?? null} rank={detailRank} nearTie={detailFor ? nearTieNote(detailFor, eligible) : null} onClose={() => setDetailKey(null)} />

      </div>
    );
  }

  return (
    <div className="scan-decision mt-6 bg-background pb-6">
      <TheCall row={call} kind={callKind} onOpen={() => setDetailKey(call.key)} />
      <Alternates items={alternates} onOpen={setDetailKey} />
      <TheRest
        rows={restRows}
        pendingSkeletons={pendingSkeletons}
        onOpen={setDetailKey}
        stillReading={stillReading}
        currency={currency}
      />
      <ScanThumbBar
        onRescan={onRescan}
        controls={controls}
        setControls={setControls}
        currency={currency}
        rows={rows}
      />
      <ScanDetailSheet row={detailFor} scannedAt={scannedAt} scanId={scanId ?? null} rank={detailRank} nearTie={detailFor ? nearTieNote(detailFor, eligible) : null} onClose={() => setDetailKey(null)} />

    </div>
  );
}

