import { useMemo, useState } from "react";
import type { ScanRow } from "./types";
import { TheCall } from "./TheCall";
import { Alternates } from "./Alternates";
import { pickAlternates } from "./pick-alternates";
import { TheRest } from "./TheRest";
import { ScanDetailSheet } from "./ScanDetailSheet";
import { ScanThumbBar } from "./ScanThumbBar";
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
}: {
  rows: ScanRow[];
  pendingSkeletons: number;
  stillReading: boolean;
  scannedAt: number | null;
  onRescan: () => void;
  controls: Controls;
  setControls: (c: Controls) => void;
  currency?: CurrencyCode;
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

    if (eligible.length === 0) {
      return { call: null as ScanRow | null, callKind: "your-pick" as const, alternates: [], restRows: rows };
    }

    // Deterministic tie-break. When several wines sit within 0.1★ of the best
    // score, the screen must still name ONE bottle — handing back "here are two,
    // you decide" is the work the person came here to avoid. Order:
    //   1. better value verdict (a good-value wine wins)
    //   2. lower price
    //   3. more confident read (clean catalog match, then closer to a rated wine)
    const TIE = 0.1;
    const best = eligible[0].ranked.predicted;
    const tied = eligible.filter((r) => best - r.ranked.predicted <= TIE);
    const top = [...tied].sort((a, b) => {
      if (a.greatValue !== b.greatValue) return a.greatValue ? -1 : 1;
      const pa = a.price_amount ?? Number.POSITIVE_INFINITY;
      const pb = b.price_amount ?? Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      if (a.isCatalog !== b.isCatalog) return a.isCatalog ? -1 : 1;
      return b.ranked.maxSimilarity - a.ranked.maxSimilarity;
    })[0];

    const kind: "your-pick" | "closest-match" =
      top.ranked.predicted < 4.0 ? "closest-match" : "your-pick";

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
          currency={currency}
        />
        <ScanDetailSheet row={detailFor} scannedAt={scannedAt} onClose={() => setDetailKey(null)} />
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
      <ScanDetailSheet row={detailFor} scannedAt={scannedAt} onClose={() => setDetailKey(null)} />

    </div>
  );
}

