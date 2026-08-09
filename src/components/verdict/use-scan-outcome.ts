/**
 * The choice log. CAPTURE ONLY.
 *
 * A star rating is one wine in isolation. "I ordered this one, off that list,
 * at that price, having seen your pick" is a preference against known
 * alternatives — the thing the recommender is actually trying to get right.
 * We were discarding all of it.
 *
 * Nothing here feeds scoring, weighting, or ranking. It writes one row per
 * person per scan and never blocks the decision screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/error-message";
import { logWriteFailure } from "@/lib/write-failure-log";
import type { ScanRow } from "./types";
import { outcomeBottleId } from "./types";

function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : ((v[mid - 1]! + v[mid]!) / 2);
}

export type ScanOutcomeApi = {
  /** Whether the control should render at all — needs a persisted scan. */
  enabled: boolean;
  /** Catalog bottle id of the current answer, or null. */
  chosenBottleId: string | null;
  /** True when this row is the recorded answer. Compares CATALOG ids, never
   *  the synthetic per-scan key. */
  isOrdered: (row: ScanRow) => boolean;
  /** Tap handler: sets, replaces, or (same wine again) clears. */
  toggle: (row: ScanRow) => void;
  /** True while a write is in flight, so the control can't double-fire. */
  pending: boolean;
};

export function useScanOutcome({
  scanId,
  call,
  eligible,
  rows,
}: {
  scanId: string | null;
  call: ScanRow | null;
  eligible: ScanRow[];
  rows: ScanRow[];
}): ScanOutcomeApi {

  const [chosenBottleId, setChosen] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  // Reopening a saved scan should show the answer already given, not a blank
  // control that would overwrite it.
  useEffect(() => {
    if (!scanId) return;
    let live = true;
    void (async () => {
      const { data } = await supabase
        .from("scan_outcomes")
        .select("chosen_bottle_id")
        .eq("scan_id", scanId)
        .maybeSingle();
      if (live && data?.chosen_bottle_id) setChosen(data.chosen_bottle_id);
    })();
    return () => { live = false; };
  }, [scanId]);

  const listMedian = useMemo(
    () => median(rows.map((r) => r.price_amount ?? NaN)),
    [rows],
  );

  const rankOf = useCallback(
    (row: ScanRow): number | null => {
      if (call && row.key === call.key) return 1;
      const i = eligible.findIndex((r) => r.key === row.key);
      return i >= 0 ? i + 1 : null;
    },
    [call, eligible],
  );

  const isOrdered = useCallback(
    (row: ScanRow) => {
      const id = outcomeBottleId(row);
      return !!id && id === chosenBottleId;
    },
    [chosenBottleId],
  );

  const toggle = useCallback(
    (row: ScanRow) => {
      if (!scanId || inFlight.current) return;
      // MUST be the catalog bottles.id — the ranker's `scan-N` key is not a
      // uuid and the write fails on every tap if it leaks through.
      const bottleId = outcomeBottleId(row);
      if (!bottleId) {
        toast("We can only save this once the wine is identified in the catalog.");
        return;
      }
      const clearing = chosenBottleId === bottleId;

      inFlight.current = true;
      setPending(true);
      // Optimistic: the tap is the whole interaction, so it must feel instant.
      const previous = chosenBottleId;
      setChosen(clearing ? null : bottleId);


      void (async () => {
        try {
          const { data: auth } = await supabase.auth.getUser();
          const uid = auth.user?.id;
          if (!uid) throw new Error("Sign in to save what you ordered.");

          if (clearing) {
            const { error } = await supabase
              .from("scan_outcomes")
              .delete()
              .eq("user_id", uid)
              .eq("scan_id", scanId);
            if (error) throw error;
            return;
          }

          const { data: b } = await supabase
            .from("bottles")
            .select("fp_pipeline")
            .eq("id", bottleId)
            .maybeSingle();

          const { error } = await supabase.from("scan_outcomes").upsert(
            {
              user_id: uid,
              scan_id: scanId,
              chosen_bottle_id: bottleId,
              chosen_predicted: row.ranked.predicted > 0 ? row.ranked.predicted : null,
              chosen_rank: rankOf(row),
              call_bottle_id: call?.ranked.bottle.id ?? null,
              call_predicted: call && call.ranked.predicted > 0 ? call.ranked.predicted : null,
              n_candidates: rows.length,
              chosen_price: row.price_amount,
              call_price: call?.price_amount ?? null,
              list_price_median: listMedian,
              chosen_fp_pipeline: b?.fp_pipeline ?? null,
            },
            { onConflict: "user_id,scan_id" },
          );
          if (error) throw error;

          toast(`Noted — you ordered the ${row.ranked.bottle.name}.`, {
            duration: 6000,
            action: {
              label: "Undo",
              onClick: () => {
                setChosen(null);
                void (async () => {
                  const { error: delErr } = await supabase
                    .from("scan_outcomes")
                    .delete()
                    .eq("user_id", uid)
                    .eq("scan_id", scanId);
                  if (delErr) {
                    await logWriteFailure({
                      table: "scan_outcomes",
                      operation: "delete",
                      error: delErr,
                      userId: uid,
                      context: { scan_id: scanId, undo: true },
                    });
                  }
                })();
              },
            },
          });
        } catch (e) {
          setChosen(previous);
          // The user sees a friendly message; the measurement layer records the
          // row that was lost, so a broken write path is never mistaken for an
          // unused feature.
          await logWriteFailure({
            table: "scan_outcomes",
            operation: clearing ? "delete" : "upsert",
            error: e,
            context: {
              scan_id: scanId,
              chosen_bottle_id: clearing ? null : bottleId,
              chosen_rank: clearing ? null : rankOf(row),
              n_candidates: rows.length,
            },
          });
          toast.error(friendlyError(e, "Couldn't save what you ordered."));
        } finally {
          inFlight.current = false;
          setPending(false);
        }
      })();
    },
    [scanId, chosenBottleId, call, rows, listMedian, rankOf],
  );

  return { enabled: !!scanId, chosenBottleId, isOrdered, toggle, pending };
}
