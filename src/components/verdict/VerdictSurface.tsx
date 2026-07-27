import { useMemo, useState } from "react";
import type { ScanRow } from "./types";
import { TheCall } from "./TheCall";
import { Alternates } from "./Alternates";
import { pickAlternates } from "./pick-alternates";
import { TheRest } from "./TheRest";
import { ScanDetailSheet } from "./ScanDetailSheet";
import { ScanThumbBar } from "./ScanThumbBar";
import type { Controls } from "@/lib/list-controls";

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
  boosted,
  onBoost,
  controls,
  setControls,
}: {
  rows: ScanRow[];
  pendingSkeletons: number;
  stillReading: boolean;
  scannedAt: number | null;
  onRescan: () => void;
  boosted: boolean;
  onBoost: () => void;
  controls: Controls;
  setControls: (c: Controls) => void;
}) {
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const detailFor = useMemo(
    () => rows.find((r) => r.key === detailKey) ?? null,
    [rows, detailKey],
  );

  const { call, callKind, alternates, restRows } = useMemo(() => {
    const eligible = rows
      .filter((r) => !r.ranked.vetoed && r.ranked.predicted > 0)
      .sort((a, b) => b.ranked.predicted - a.ranked.predicted);

    // Fallback when nothing has a real predicted score yet
    if (eligible.length === 0) {
      return { call: null as ScanRow | null, callKind: "your-pick" as const, alternates: [], restRows: rows };
    }

    const top = eligible[0];
    const isTie = eligible[1] && Math.abs(eligible[1].ranked.predicted - top.ranked.predicted) <= 0.1;
    const zeroStrong = top.ranked.predicted < 4.0;
    const kind: "your-pick" | "closest-match" | "top-two" =
      isTie ? "top-two" : zeroStrong ? "closest-match" : "your-pick";

    const alts = pickAlternates(top, eligible);
    const heroKeys = new Set([top.key, ...alts.map((a) => a.row.key)]);
    const rest = rows.filter((r) => !heroKeys.has(r.key));
    return { call: top, callKind: kind, alternates: alts, restRows: rest };
  }, [rows]);

  if (!call) {
    return (
      <div className="mt-6">
        <TheRest
          rows={restRows}
          pendingSkeletons={pendingSkeletons}
          onOpen={setDetailKey}
          stillReading={stillReading}
        />
        <ScanDetailSheet row={detailFor} scannedAt={scannedAt} onClose={() => setDetailKey(null)} />
      </div>
    );
  }

  return (
    <div className="scan-decision mt-6 bg-background pb-6" data-boost={boosted ? "on" : "off"}>
      <TheCall row={call} kind={callKind} onOpen={() => setDetailKey(call.key)} />
      <Alternates items={alternates} onOpen={setDetailKey} />
      <TheRest
        rows={restRows}
        pendingSkeletons={pendingSkeletons}
        onOpen={setDetailKey}
        stillReading={stillReading}
      />
      <ScanThumbBar
        boosted={boosted}
        onBoost={onBoost}
        onRescan={onRescan}
        controls={controls}
        setControls={setControls}
      />
      <ScanDetailSheet row={detailFor} scannedAt={scannedAt} onClose={() => setDetailKey(null)} />
    </div>
  );
}
