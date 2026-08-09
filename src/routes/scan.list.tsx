import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { applyControls, DEFAULT_CONTROLS, type Controls } from "@/lib/list-controls";
import { CellarMemorySection } from "@/components/CellarMemorySection";
import { SommelierBriefDialog } from "@/components/SommelierBriefDialog";
import { VerdictSurface } from "@/components/verdict";
import { PastScansHistory } from "@/components/PastScansHistory";
import { PrescanRestaurantPicker, VenueAttribution } from "@/components/RestaurantPickers";
import { DrinkingGroupSelector } from "@/components/DrinkingGroupSelector";
import { ScanEntryButtons, StagedPhotos, BatchProgress } from "@/components/ScanCaptureShell";
import { ScanStateMessage, type ScanFailure } from "@/components/ScanStateMessage";
import {
  takePendingCapture,
  subscribePendingCapture,
  pendingCaptureVersion,
  hasPendingCapture,
} from "@/lib/scan-handoff";
import { ServiceModeSwitch } from "@/components/ServiceModeSwitch";
import { useScanCapture } from "@/hooks/use-scan-capture";
import { useScanRanking } from "@/hooks/use-scan-ranking";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import type { CurrencyCode } from "@/lib/currency";

/** Fetch the restaurant's stored currency — populated only by prior scans
 *  that read a symbol off the list itself. Never a locale/default guess. */
function useRestaurantCurrency(restaurantId: string | null) {
  return useQuery({
    queryKey: ["restaurant-currency", restaurantId],
    enabled: !!restaurantId,
    queryFn: async () => {
      const { data } = await supabase.from("restaurants").select("currency").eq("id", restaurantId!).maybeSingle();
      const c = (data as { currency: string | null } | null)?.currency ?? null;
      return (c as CurrencyCode | null);
    },
  });
}

/** Read the currency finalize wrote for THIS scan. One value, one owner: the
 *  column is authoritative and derivation is only the fallback when it's null.
 *  Two paths computing the same figure is how scans.currency drifted to null
 *  while every wine on it carried USD. */
function useScanCurrency(scanId: string | null) {
  return useQuery({
    queryKey: ["scan-currency", scanId],
    enabled: !!scanId,
    queryFn: async () => {
      const { data } = await supabase.from("scans").select("currency").eq("id", scanId!).maybeSingle();
      const c = (data as { currency: string | null } | null)?.currency ?? null;
      return (c as CurrencyCode | null);
    },
  });
}




export const Route = createFileRoute("/scan/list")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Scan a wine list — Palate Match" },
      { name: "description", content: "Photograph a restaurant wine list. We rank every bottle in plain English for the wine you'll actually love." },
    ],
  }),
  component: Scan,
});

function Scan() {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [sommOpen, setSommOpen] = useState(false);
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);
  // The restaurant picker is optional and was the largest block on an idle
  // screen, so it starts collapsed behind one text link.
  const [showRestaurant, setShowRestaurant] = useState(false);

  const cap = useScanCapture();
  // Once a restaurant is known (prescan pick or server-side auto-attribution),
  // pull its stored currency. This is a direct fact — only ever set by a
  // scan whose currency came from OCR text — so it's safe to feed straight
  // into the resolution chain. Symbol-bearing text on the current list still
  // wins (step 2), which is correct for mixed-currency venues.
  const restaurantId = cap.prescanRestaurant?.id ?? null;
  const { data: restaurantCurrency } = useRestaurantCurrency(restaurantId);
  // Stored scan currency wins; derivation runs only when the column is null
  // (an in-flight scan, or one finalized before the aggregation shipped).
  const { data: storedScanCurrency } = useScanCurrency(cap.scanId ?? null);
  const rank = useScanRanking(cap.wines, storedScanCurrency ?? null, restaurantCurrency ?? null);


  // Photo captured on the chooser sheet. The camera already opened there, so
  // this screen is the review step, never a gate in front of the camera.
  //
  // The chooser lives in the app shell, so tapping SCAN while already standing
  // on this route is a no-op navigation: nothing remounts and a mount-only
  // effect never fires. So the hand-off is a subscription, and the arrival
  // itself is what clears prior state — never a button, never a mount.
  const handoffVersion = useSyncExternalStore(
    subscribePendingCapture,
    pendingCaptureVersion,
    pendingCaptureVersion,
  );
  // Read synchronously during render: on the first paint after entry a waiting
  // hand-off suppresses every prior-attempt surface, so a previous failure
  // cannot flash before the consuming effect runs.
  const handoffWaiting = hasPendingCapture("list");

  useEffect(() => {
    const files = takePendingCapture("list");
    if (!files) return;
    cap.beginNewScan();
    cap.addFileObjects(files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoffVersion]);

  const surfaceRows = useMemo(() => applyControls(rank.allRowsFlat, controls), [rank.allRowsFlat, controls]);
  const anyBatchInFlight = cap.batches.some((b) => b.status === "running" || b.status === "pending");
  const pendingSkeletons = Math.min(cap.batches.filter((b) => b.status === "pending" || b.status === "running").length * 4, 8);
  const anyFailedBatch = cap.batches.some((b) => b.status === "failed");
  const readFailed = !cap.isRunning && cap.status !== "idle" && rank.readable.length === 0 && !anyBatchInFlight;

  // ONE failure state for the whole screen. An error and a success state are
  // mutually exclusive by construction: `showDecisionSurface` is false whenever
  // `failure` is non-null.
  const failure: ScanFailure | null = handoffWaiting
    ? null
    : cap.mutation.isError
    ? { kind: "threw", error: cap.mutation.error }
    : readFailed
    ? { kind: "unreadable" }
    : null;


  // A decision surface with nothing to decide is not a decision surface. While
  // a scan is reading with zero wines behind it, the scan state is the only
  // thing on screen — no verdict shell, no "see all 0 wines" disclosure.
  const showDecisionSurface = !failure && rank.enoughRatings && rank.readable.length > 0;
  const totalWines = rank.dedupWines.length;
  const resumable = !failure && !handoffWaiting && !!cap.resumedAt && !!cap.scanId && cap.batches.length > 0 && cap.staged.length === 0 && !cap.dismissedResume;
  // A full wine list that came back with one or two wines barely worked. Say so
  // rather than presenting it as a normal resume.
  const thinResume = resumable && totalWines > 0 && totalWines < 3;
  const inScanFlow = cap.staged.length > 0 || cap.isRunning || !!cap.scanId;
  const inReview = cap.staged.length > 0 && !cap.isRunning;
  const idle = !failure && !inScanFlow && !resumable;
  const scannedAtMs = cap.scanLogId ? Date.now() : cap.resumedAt ? new Date(cap.resumedAt).getTime() : null;

  const restaurantBlock = (
    <div className="mt-4">
      {showRestaurant || cap.prescanRestaurant ? (
        <PrescanRestaurantPicker
          value={cap.prescanRestaurant}
          onChange={cap.setPrescanRestaurant}
          disabled={cap.isRunning || !!cap.scanId}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowRestaurant(true)}
          className="min-h-11 text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Add a restaurant (optional)
        </button>
      )}
    </div>
  );

  return (
    <div className="pt-2">
      {/* Dark-restaurant mode is a service tool, not a first action — it stays
          out of the idle screen so the scan CTA is the only thing on it. */}
      {!idle && (
        <div className="flex justify-end mb-2">
          <ServiceModeSwitch />
        </div>
      )}

      {/* ── ERROR ───────────────────────────────────────────────────────── */}
      {failure && (
        <ScanStateMessage failure={failure} onRetry={cap.startOver} />
      )}

      {/* ── RESUMABLE ───────────────────────────────────────────────────── */}
      {resumable && (
        <div className="mt-2 rounded-xl border border-primary/40 bg-primary/5 p-4">
          {thinResume ? (
            <>
              <p className="text-sub font-medium text-foreground">
                Only {totalWines} wine{totalWines === 1 ? "" : "s"} was read last time — you may want to rescan.
              </p>
              <p className="mt-1 text-meta text-muted-foreground">
                From your scan at {new Date(cap.resumedAt!).toLocaleTimeString()}.
              </p>
            </>
          ) : (
            <>
              <p className="text-sub font-medium text-foreground">
                Resuming your last scan · {new Date(cap.resumedAt!).toLocaleTimeString()}
              </p>
              <p className="mt-1 text-meta text-muted-foreground">
                {totalWines} wine{totalWines === 1 ? "" : "s"} loaded from earlier today.
              </p>
            </>
          )}
          <button
            onClick={cap.startOver}
            className="mt-3 min-h-11 rounded-md border border-border bg-card px-4 py-2 text-sub font-medium"
          >
            Start a new scan
          </button>
        </div>
      )}

      {/* ── IDLE: one primary action ────────────────────────────────────── */}
      {idle && (
        <>
          <ScanEntryButtons
            cameraRef={cameraRef} libraryRef={libraryRef}
            disabled={cap.isRunning || cap.staged.length >= 8}
            onPick={cap.addFiles}
          />
          {restaurantBlock}
          <PastScansHistory />
        </>
      )}

      {/* ── REVIEW: thumbnail, retake/add, continue ─────────────────────── */}
      {inReview && (
        <>
          <StagedPhotos staged={cap.staged} isRunning={cap.isRunning} onRemove={cap.removeAt} />

          <div className="mt-3 flex flex-wrap gap-3">
            <button onClick={cap.submit} disabled={cap.isRunning}
              className="min-h-11 rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sub font-medium disabled:opacity-60">
              {`Scan ${cap.staged.length} photo${cap.staged.length > 1 ? "s" : ""}`}
            </button>
            <button onClick={cap.startOver}
              className="min-h-11 rounded-md border border-border bg-card px-4 py-2.5 text-sub font-medium">
              Start a new scan
            </button>
          </div>

          {/* Secondary paths for people working from screenshots. */}
          <div className="mt-3 flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="min-h-11 text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Add another page
            </button>
            <button
              type="button"
              onClick={() => libraryRef.current?.click()}
              className="min-h-11 text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Choose from library
            </button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => cap.addFiles(e.target.files, e.currentTarget)} />
          <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => cap.addFiles(e.target.files, e.currentTarget)} />

          {restaurantBlock}
          <div className="mt-4">
            <DrinkingGroupSelector selectedIds={rank.group.friendIds} onToggle={rank.group.toggle} onClear={rank.group.clear} onSet={rank.group.set} />
          </div>
        </>
      )}

      {/* ── READING / RESULTS ──────────────────────────────────────────── */}
      {/* The progress card exists to fill the wait. Once results render it is
          noise that pushes the Call below the fold — swap it for one quiet line.
          Failed pages keep the card, because it carries the retry action. */}
      {!failure && (!showDecisionSurface || anyFailedBatch) && (
        <BatchProgress batches={cap.batches} isRunning={cap.isRunning} elapsed={cap.elapsed} onRetry={cap.retryFailed} />
      )}

      {/* ── STALLED ─────────────────────────────────────────────────────────
          15 seconds with nothing new landing. A reading screen with no exit
          should be impossible, so this always carries a way out. */}
      {!failure && cap.stalled && anyBatchInFlight && (
        <div className="mt-3 rounded-md border border-border bg-card p-3" role="status" aria-live="polite">
          <p className="text-sub text-foreground">
            This is taking longer than usual{cap.wines.length > 0 ? ` — ${cap.wines.length} wine${cap.wines.length === 1 ? "" : "s"} read so far.` : "."}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {cap.wines.length > 0 && (
              <button
                type="button"
                onClick={() => { void cap.readSoFar(); }}
                className="min-h-11 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sub font-medium"
              >
                Read what we have so far
              </button>
            )}
            <button
              type="button"
              onClick={cap.startOver}
              className="min-h-11 rounded-md border border-border bg-card px-4 py-2 text-sub font-medium"
            >
              Start a new scan
            </button>
          </div>
        </div>
      )}

      {showDecisionSurface && anyBatchInFlight && !anyFailedBatch && (
        <p className="mt-3 text-meta text-muted-foreground" role="status" aria-live="polite">
          Still reading page {(cap.batches.find((b) => b.status === "running" || b.status === "pending")?.pageNumbers ?? []).join("–") || "…"}
        </p>
      )}

      {!failure && !rank.enoughRatings && rank.readable.length > 0 && (
        <div className="mt-5 rounded-md border border-primary/40 bg-primary/5 p-3 text-meta">
          <span className="font-semibold text-foreground">Finish calibration to rank this list.</span>{" "}
          <span className="text-muted-foreground">One minute of tapping — no wine names.</span>{" "}
          <Link to="/onboarding" className="text-primary underline underline-offset-2">Start calibration →</Link>
        </div>
      )}

      {showDecisionSurface && rank.provisional && (
        <div className="mt-5 rounded-md border border-primary/30 bg-primary/5 p-3 text-meta">
          <span className="font-semibold text-foreground">Provisional</span>
          <span className="text-muted-foreground"> — based on your style answers. Rate a real bottle to sharpen these predictions.</span>
        </div>
      )}

      {showDecisionSurface && rank.readable.length > 0 && rank.lowConfTypes.length > 0 && (
        <div className="pm-uncertain mt-5 rounded-md p-3 text-meta text-muted-foreground">
          <span className="text-foreground font-medium">Low confidence on {rank.lowConfTypes.join(" & ")}</span> — you've rated{" "}
          {rank.lowConfTypes.map((t) => `${rank.perTypeRated.get(t) ?? 0} ${t}`).join(", ")} so far. Rankings will sharpen once you're past {rank.MIN_PER_TYPE} per type.{" "}
          <Link to="/rate" className="text-primary underline underline-offset-2">Rate more →</Link>
        </div>
      )}

      {showDecisionSurface && (
        <VerdictSurface
          rows={surfaceRows}
          pendingSkeletons={pendingSkeletons}
          stillReading={anyBatchInFlight}
          scannedAt={scannedAtMs}
          onRescan={cap.startOver}
          controls={controls}
          setControls={setControls}
          currency={rank.currency}
          scanId={cap.scanId ?? null}
        />
      )}

      {showDecisionSurface && (
        <div className="mt-8 space-y-4">
          {cap.autoAttributedTo && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sub">
              Added to <span className="font-medium">{cap.autoAttributedTo}</span>.
            </div>
          )}
          {cap.scanId && totalWines > 0 && !cap.autoAttributedTo && (
            <VenueAttribution scanId={cap.scanId} scanLogId={cap.scanLogId} />
          )}
          <CellarMemorySection matches={rank.cellar.matches} predictionsByIndex={rank.predictionsByIndex} />
          {totalWines > 0 && (
            <button type="button" onClick={() => setSommOpen(true)} className="text-label uppercase text-muted-foreground hover:text-primary">
              Show your palate to the somm →
            </button>
          )}
        </div>
      )}

      {showDecisionSurface && rank.unreadable.length > 0 && (
        <div className="mt-8">
          <h2 className="font-serif text-base">Couldn't read these</h2>
          <ul className="mt-2 text-meta text-muted-foreground space-y-1">
            {rank.unreadable.map((w, i) => (
              <li key={i}>{[w.producer, w.wine_name, w.vintage].filter(Boolean).join(" ") || "(illegible)"}</li>
            ))}
          </ul>
        </div>
      )}

      <SommelierBriefDialog open={sommOpen} onClose={() => setSommOpen(false)} />
    </div>
  );
}
