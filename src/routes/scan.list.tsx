import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyControls, DEFAULT_CONTROLS, type Controls } from "@/lib/list-controls";
import { CellarMemorySection } from "@/components/CellarMemorySection";
import { SommelierBriefDialog } from "@/components/SommelierBriefDialog";
import { VerdictSurface } from "@/components/verdict";
import { PastScansHistory } from "@/components/PastScansHistory";
import { PrescanRestaurantPicker, RestaurantAttribution } from "@/components/RestaurantPickers";
import { DrinkingGroupSelector } from "@/components/DrinkingGroupSelector";
import { ScanEntryButtons, StagedPhotos, BatchProgress } from "@/components/ScanCaptureShell";
import { ServiceModeSwitch } from "@/components/ServiceModeSwitch";
import { useScanCapture } from "@/hooks/use-scan-capture";
import { useScanRanking } from "@/hooks/use-scan-ranking";

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


  const cap = useScanCapture();
  // Fetch the picked/attributed restaurant's locale so restaurant-country
  // can enter the currency resolution chain (see useScanRanking). Fires
  // only once a restaurant id is known — either from prescan or the
  // server-side auto-attribution that runs during finalize. When it
  // resolves, the ranking memo recomputes and the UI re-renders with the
  // corrected currency; a symbol-free Paris list stops rendering as USD.
  const restaurantId = cap.prescanRestaurant?.id ?? null;
  const { data: restaurantLocale } = useRestaurantLocale(restaurantId);
  const restaurantCountry = countryFromLocale(restaurantLocale);
  const rank = useScanRanking(cap.wines, null, restaurantCountry);


  // Auto-open camera when arriving from the center-scan chooser (?capture=1).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("capture") !== "1") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("capture");
    window.history.replaceState({}, "", url.toString());
    const t = setTimeout(() => cameraRef.current?.click(), 60);
    return () => clearTimeout(t);
  }, []);

  const surfaceRows = useMemo(() => applyControls(rank.allRowsFlat, controls), [rank.allRowsFlat, controls]);
  const anyBatchInFlight = cap.batches.some((b) => b.status === "running" || b.status === "pending");
  const pendingSkeletons = Math.min(cap.batches.filter((b) => b.status === "pending" || b.status === "running").length * 4, 8);
  const showDecisionSurface = rank.enoughRatings && (rank.readable.length > 0 || anyBatchInFlight);
  const readFailed = !cap.isRunning && cap.status !== "idle" && rank.readable.length === 0 && !anyBatchInFlight;
  const totalWines = rank.dedupWines.length;
  const showResumeBanner = !!cap.resumedAt && !!cap.scanId && cap.batches.length > 0 && cap.staged.length === 0 && !cap.dismissedResume;
  const inScanFlow = cap.staged.length > 0 || cap.isRunning || !!cap.scanId;
  const scannedAtMs = cap.scanLogId ? Date.now() : cap.resumedAt ? new Date(cap.resumedAt).getTime() : null;

  return (
    <div className="pt-2">
      <div className="flex justify-end mb-2">
        <ServiceModeSwitch />
      </div>

      {showResumeBanner && (
        <div className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sub flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Resuming your last scan · {new Date(cap.resumedAt!).toLocaleTimeString()}</p>
            <p className="text-meta text-muted-foreground mt-0.5">
              {totalWines} wine{totalWines === 1 ? "" : "s"} loaded from earlier today.
            </p>
          </div>
          <button onClick={cap.startOver} className="shrink-0 rounded-md border border-border bg-card px-3 py-1.5 text-meta font-medium">
            Start a new scan
          </button>
        </div>
      )}

      <ScanEntryButtons
        cameraRef={cameraRef} libraryRef={libraryRef}
        disabled={cap.isRunning || cap.staged.length >= 8}
        onPick={cap.addFiles}
      />

      {inScanFlow && (
        <>
          <PrescanRestaurantPicker value={cap.prescanRestaurant} onChange={cap.setPrescanRestaurant} disabled={cap.isRunning || !!cap.scanId} />
          {!cap.scanId && !cap.isRunning && (
            <div className="mt-4">
              <DrinkingGroupSelector selectedIds={rank.group.friendIds} onToggle={rank.group.toggle} onClear={rank.group.clear} onSet={rank.group.set} />
            </div>
          )}
        </>
      )}

      {!inScanFlow && !showResumeBanner && <PastScansHistory />}

      {(cap.staged.length > 0 || (cap.scanId && !cap.isRunning)) && (
        <div className="mt-3 flex flex-wrap gap-3">
          {cap.staged.length > 0 && (
            <button onClick={cap.submit} disabled={cap.isRunning}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sub font-medium disabled:opacity-60">
              {cap.isRunning ? "Reading…" : `Scan ${cap.staged.length} photo${cap.staged.length > 1 ? "s" : ""}`}
            </button>
          )}
          {(cap.staged.length > 0 || cap.scanId) && !cap.isRunning && (
            <button onClick={cap.startOver} className="rounded-md border border-border bg-card px-4 py-2.5 text-sub font-medium">
              Start over
            </button>
          )}
        </div>
      )}

      <StagedPhotos staged={cap.staged} isRunning={cap.isRunning} onRemove={cap.removeAt} />

      <BatchProgress batches={cap.batches} isRunning={cap.isRunning} elapsed={cap.elapsed} onRetry={cap.retryFailed} />

      {cap.mutation.isError && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sub text-destructive">{(cap.mutation.error as Error).message}</p>
        </div>
      )}

      {!cap.isRunning && cap.status !== "idle" && rank.readable.length === 0 && (
        <p className="mt-6 text-sub text-muted-foreground">
          Couldn't read anything from those photos — try a clearer, straight-on shot in good light.
        </p>
      )}

      {!rank.enoughRatings && rank.readable.length > 0 && (
        <div className="mt-5 rounded-md border border-border bg-card p-3 text-meta text-muted-foreground">
          Rate a few wines first so I can match this list to your taste. Showing the list in the order it was read.
        </div>
      )}

      {rank.enoughRatings && rank.readable.length > 0 && rank.lowConfTypes.length > 0 && (
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
        />
      )}

      {showDecisionSurface && (
        <div className="mt-8 space-y-4">
          <CellarMemorySection matches={rank.cellar.matches} predictionsByIndex={rank.predictionsByIndex} />
          {cap.autoAttributedTo && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sub">
              Added to <span className="font-medium">{cap.autoAttributedTo}</span>.
            </div>
          )}
          {cap.scanLogId && totalWines > 0 && !cap.autoAttributedTo && <RestaurantAttribution scanId={cap.scanLogId} />}
          {totalWines > 0 && (
            <button type="button" onClick={() => setSommOpen(true)} className="text-label uppercase text-muted-foreground hover:text-primary">
              Show your palate to the somm →
            </button>
          )}
        </div>
      )}

      {readFailed && (
        <div className="mt-6 rounded-md border border-border bg-card p-4 text-sub">
          <p className="text-foreground">Couldn't read that list.</p>
          <p className="mt-1 text-meta text-muted-foreground">Try again with more light, or hold the phone closer.</p>
          <button onClick={cap.startOver} className="mt-3 rounded-md bg-primary text-primary-foreground px-3 py-2 text-meta font-medium min-h-11">
            Re-scan
          </button>
        </div>
      )}

      {rank.unreadable.length > 0 && (
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
