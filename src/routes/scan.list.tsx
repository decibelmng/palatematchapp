import { createFileRoute, Link } from "@tanstack/react-router";
import { ScanLine, ArrowRight, Image as ImageIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { useMyCanons } from "@/hooks/use-canon";
import { useSession } from "@/hooks/use-session";
import { useGroupSelection, useGroupPredict, type GroupCandidateInput } from "@/hooks/use-friends";
import { recommend, type BottleFp, type RatedFp, type Recommendation, type WineType } from "@/lib/recommender";
import { aggregateRated } from "@/lib/cuvee";
import { applyControls, normalizePrice, isGreatValue, DEFAULT_CONTROLS, type Controls } from "@/lib/list-controls";
import { computeCellarMemory } from "@/lib/cellar-memory";
import { CellarMemorySection } from "@/components/CellarMemorySection";
import { SommelierBriefDialog } from "@/components/SommelierBriefDialog";
import { priceVerdict } from "@/lib/price-verdict";
import { VerdictSurface, type ScanRow, type Ranked } from "@/components/verdict";
import { PastScansHistory } from "@/components/PastScansHistory";
import { PrescanRestaurantPicker, RestaurantAttribution } from "@/components/RestaurantPickers";
import { DrinkingGroupSelector } from "@/components/DrinkingGroupSelector";
import { useScanCapture } from "@/hooks/use-scan-capture";

export const Route = createFileRoute("/scan/list")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Scan a wine list — Palate Match" },
      { name: "description", content: "Photograph a restaurant wine list. We rank every bottle by predicted stars for your palate." },
    ],
  }),
  component: Scan,
});

function Scan() {
  const session = useSession();
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);
  const { data: myCanons } = useMyCanons();

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [sommOpen, setSommOpen] = useState(false);
  const [boosted, setBoosted] = useState(false);
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);

  const cap = useScanCapture();
  const {
    staged, wines, batches, scanLogId, status, isRunning, elapsed,
    resumedAt, dismissedResume, prescanRestaurant, autoAttributedTo, mutation,
    setPrescanRestaurant, addFiles, removeAt, submit, retryFailed, startOver,
  } = cap;
  const scanId = cap.scanId;

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

  // Dedup + categorize scanned wines
  const dedupWines = useMemo(() => {
    const key = (w: any) => [w.producer, w.wine_name, w.vintage ?? ""].map((s) => String(s ?? "").toLowerCase().trim()).join("|");
    const seen = new Set<string>();
    const out: typeof wines = [];
    for (const w of wines) { const k = key(w); if (seen.has(k)) continue; seen.add(k); out.push(w); }
    return out;
  }, [wines]);
  const readable = dedupWines.filter((w) => w.fp_resolved);
  const unreadable = dedupWines.filter((w) => !w.fp_resolved);
  const matchedCount = dedupWines.filter((w) => w.fp_source === "catalog").length;
  const estimatedCount = dedupWines.filter((w) => w.fp_source === "estimated").length;

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

  const cellar = useMemo(() => computeCellarMemory({
    readable, ratedBottles: ratedBottles ?? [], ratings: ratings ?? [], canons: myCanons ?? [],
  }), [readable, ratedBottles, ratings, myCanons]);

  const ranked: Ranked[] = useMemo(() => {
    if (readable.length === 0) return [];
    const candidates: BottleFp[] = readable.map((w, i) => ({
      id: `scan-${i}`,
      name: [w.producer, w.wine_name, w.vintage].filter(Boolean).join(" ") || "Unknown wine",
      producer: w.producer ?? null, region: w.region ?? null,
      type: (w.type ?? "red") as WineType, fp: w.fp_resolved!,
    }));
    if (ratedRows.length === 0) {
      return candidates.map((b, i) => ({
        bottle: b, predicted: 0, nearest: null, nearestIsCanon: false, maxSimilarity: 0, confidence: 0,
        evidence: 0, evidenceTier: "exploratory" as const, vetoed: false, vetoReason: null,
        contested: false, contestedReason: null, scanned: readable[i],
      }));
    }
    const recs = recommend(ratedRows, candidates);
    const byId = new Map(readable.map((w, i) => [`scan-${i}`, w]));
    return recs.map((r) => ({ ...r, scanned: byId.get(r.bottle.id)! }));
  }, [readable, ratedRows]);

  const predictionsByIndex = useMemo(() => {
    const m = new Map<number, Recommendation>();
    for (const r of ranked) {
      const idx = Number(r.bottle.id.replace("scan-", ""));
      if (!Number.isNaN(idx)) m.set(idx, r);
    }
    return m;
  }, [ranked]);

  const enoughRatings = ratedRows.length >= 3;

  const MIN_PER_TYPE = 8;
  const perTypeRated = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of ratedRows) m.set(r.type, (m.get(r.type) ?? 0) + 1);
    return m;
  }, [ratedRows]);
  const lowConfTypes = useMemo(() => {
    const scanned = new Set(readable.map((w) => (w.type ?? "red") as string));
    const low: string[] = [];
    for (const t of scanned) if ((perTypeRated.get(t) ?? 0) < MIN_PER_TYPE) low.push(t);
    return low;
  }, [readable, perTypeRated]);

  const matchedBottleIds = useMemo(
    () => readable.map((w) => w.matched_bottle_id).filter((id): id is string => !!id),
    [readable],
  );
  const { data: matchedBottleRows } = useBottlesByIds(matchedBottleIds);
  const priceBandByBottleId = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const b of matchedBottleRows ?? []) m.set(b.id, b.price_band);
    return m;
  }, [matchedBottleRows]);

  // Group overlay
  const group = useGroupSelection();
  const groupCandidates: GroupCandidateInput[] = useMemo(() => {
    if (group.friendIds.length === 0) return [];
    return ranked.map((r) => ({
      id: r.bottle.id, name: r.bottle.name,
      producer: r.bottle.producer ?? null, region: r.bottle.region ?? null,
      type: r.bottle.type, fp: r.bottle.fp,
    }));
  }, [ranked, group.friendIds]);
  const groupPred = useGroupPredict(group.friendIds, groupCandidates);
  const groupScores = groupPred.data ?? null;
  const groupActive = group.friendIds.length > 0;

  // Assemble ScanRow[] with cellar exclusion + optional group overlay
  const allRowsFlat: ScanRow[] = useMemo(() => {
    const rows: ScanRow[] = [];
    ranked.forEach((r, i) => {
      const idx = Number(r.bottle.id.replace("scan-", ""));
      if (cellar.byIndex.has(idx)) return;
      const t = (r.scanned.type ?? "red") as WineType;
      const p = normalizePrice(r.scanned.price ?? null);
      const matchedId = r.scanned.matched_bottle_id;
      const band = matchedId ? priceBandByBottleId.get(matchedId) ?? null : null;
      const row: ScanRow = {
        key: r.bottle.id + "-" + i,
        ranked: r,
        type: t,
        isCatalog: r.scanned.fp_source === "catalog",
        price_amount: p.amount, price_band: p.band, price_display: p.display,
        predicted: r.predicted, greatValue: false,
        verdict: priceVerdict(p.amount, band),
      };
      row.greatValue = isGreatValue(row);
      rows.push(row);
    });
    if (!groupActive || !groupScores) return rows;
    return rows.map((r) => {
      const g = groupScores.get(r.ranked.bottle.id);
      if (!g) return r;
      const next: ScanRow = { ...r, predicted: g.group_min };
      next.greatValue = isGreatValue(next);
      return next;
    });
  }, [ranked, cellar, priceBandByBottleId, groupActive, groupScores]);

  const surfaceRows = useMemo(() => applyControls(allRowsFlat, controls), [allRowsFlat, controls]);
  const pendingSkeletons = useMemo(() => {
    const inflight = batches.filter((b) => b.status === "pending" || b.status === "running").length;
    return Math.min(inflight * 4, 8);
  }, [batches]);
  const anyBatchInFlight = batches.some((b) => b.status === "running" || b.status === "pending");
  const showDecisionSurface = enoughRatings && (readable.length > 0 || anyBatchInFlight);
  const readFailed = !isRunning && status !== "idle" && readable.length === 0 && !anyBatchInFlight;
  const totalWines = dedupWines.length;
  const failedBatches = batches.filter((b) => b.status === "failed");
  const showResumeBanner = !!resumedAt && !!scanId && batches.length > 0 && staged.length === 0 && !dismissedResume;
  const inScanFlow = staged.length > 0 || isRunning || !!scanId;
  const scannedAtMs = scanLogId ? Date.now() : resumedAt ? new Date(resumedAt).getTime() : null;

  return (
    <div className="pt-2">
      {showResumeBanner && (
        <div className="mt-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sub flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Resuming your last scan · {new Date(resumedAt!).toLocaleTimeString()}</p>
            <p className="text-meta text-muted-foreground mt-0.5">
              {totalWines} wine{totalWines === 1 ? "" : "s"} loaded from earlier today.
            </p>
          </div>
          <button onClick={startOver} className="shrink-0 rounded-md border border-border bg-card px-3 py-1.5 text-meta font-medium">
            Start a new scan
          </button>
        </div>
      )}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => addFiles(e.target.files, e.currentTarget)} />
      <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => addFiles(e.target.files, e.currentTarget)} />

      <button
        type="button"
        onClick={() => cameraRef.current?.click()}
        disabled={isRunning || staged.length >= 8}
        data-testid="scan-entry-camera"
        aria-label="Scan a wine list with your camera"
        className="mt-2 block w-full text-left rounded-[16px] border-2 border-primary/60 bg-gradient-to-br from-primary/15 via-card to-card p-4 shadow-[var(--pm-card-shadow)] hover:border-primary transition disabled:opacity-60"
      >
        <div className="flex items-center gap-3">
          <div className="shrink-0 h-12 w-12 rounded-xl bg-primary/20 text-primary flex items-center justify-center">
            <ScanLine size={24} strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-serif text-heading leading-tight text-foreground">Scan a wine list</h3>
            <p className="mt-0.5 text-meta text-muted-foreground">Point the camera at the list — I'll rank every bottle.</p>
          </div>
          <ArrowRight className="shrink-0 text-primary" size={18} />
        </div>
      </button>

      <button
        type="button"
        onClick={() => libraryRef.current?.click()}
        disabled={isRunning || staged.length >= 8}
        data-testid="scan-entry-library"
        className="mt-2 inline-flex items-center gap-1.5 text-meta text-muted-foreground hover:text-foreground disabled:opacity-60"
      >
        <ImageIcon size={14} /> Upload photos instead (up to 8 pages)
      </button>

      {inScanFlow && (
        <>
          <PrescanRestaurantPicker value={prescanRestaurant} onChange={setPrescanRestaurant} disabled={isRunning || !!scanId} />
          {!scanId && !isRunning && (
            <div className="mt-4">
              <DrinkingGroupSelector selectedIds={group.friendIds} onToggle={group.toggle} onClear={group.clear} onSet={group.set} />
            </div>
          )}
        </>
      )}

      {!inScanFlow && !showResumeBanner && <PastScansHistory />}

      {(staged.length > 0 || (scanId && !isRunning)) && (
        <div className="mt-3 flex flex-wrap gap-3">
          {staged.length > 0 && (
            <button onClick={submit} disabled={isRunning}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sub font-medium disabled:opacity-60">
              {isRunning ? "Reading…" : `Scan ${staged.length} photo${staged.length > 1 ? "s" : ""}`}
            </button>
          )}
          {(staged.length > 0 || scanId) && !isRunning && (
            <button onClick={startOver} className="rounded-md border border-border bg-card px-4 py-2.5 text-sub font-medium">
              Start over
            </button>
          )}
        </div>
      )}

      {staged.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {staged.map((s, i) => (
            <div key={s.url} className="relative">
              <img src={s.url} alt={`page ${i + 1}`} className="h-24 rounded-md border border-border object-cover" />
              {!isRunning && (
                <button onClick={() => removeAt(i)} aria-label={`Remove photo ${i + 1}`}
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-border text-meta leading-none flex items-center justify-center shadow">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {batches.length > 0 && (isRunning || anyBatchInFlight || failedBatches.length > 0) && (
        <div className="mt-4 rounded-md border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-sub font-medium">
              {isRunning ? "Reading pages…" : failedBatches.length > 0 ? "Some pages failed" : "Reading complete"}
            </p>
            {isRunning && <p className="text-meta text-muted-foreground">{elapsed}s</p>}
          </div>
          <ul className="mt-2 space-y-1 text-meta">
            {batches.map((b) => {
              const icon = b.status === "done" ? "✓" : b.status === "failed" ? "✕" : b.status === "running" ? "…" : "·";
              const tone = b.status === "done" ? "text-primary" : b.status === "failed" ? "text-destructive" : b.status === "running" ? "text-foreground" : "text-muted-foreground";
              return (
                <li key={b.index} className={`flex items-center gap-2 ${tone}`}>
                  <span className="font-mono w-4 text-center">{icon}</span>
                  <span>Pages {b.pageNumbers.join("–")}</span>
                  {b.status === "running" && (
                    <span aria-hidden className="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" />
                  )}
                  {b.status === "failed" && b.error && (
                    <span className="text-meta text-muted-foreground truncate">— {b.error}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {failedBatches.length > 0 && !isRunning && (
            <div className="mt-3">
              <button onClick={retryFailed}
                className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-meta font-medium">
                Retry {failedBatches.length} failed page{failedBatches.length === 1 ? "" : "s"}
              </button>
              {failedBatches.some((b) => b.images.length === 0) && (
                <p className="mt-1 text-meta text-muted-foreground">
                  Retry unavailable after refresh — start a new scan for the failed pages.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {mutation.isError && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sub text-destructive">{(mutation.error as Error).message}</p>
        </div>
      )}

      {!isRunning && status !== "idle" && readable.length === 0 && (
        <p className="mt-6 text-sub text-muted-foreground">
          Couldn't read anything from those photos — try a clearer, straight-on shot in good light.
        </p>
      )}

      {!enoughRatings && readable.length > 0 && (
        <div className="mt-5 rounded-md border border-border bg-card p-3 text-meta text-muted-foreground">
          Rate a few wines first so I can match this list to your taste. Showing the list in the order it was read.
        </div>
      )}

      {enoughRatings && readable.length > 0 && lowConfTypes.length > 0 && (
        <div className="mt-5 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-meta text-muted-foreground">
          <span className="text-foreground font-medium">Low confidence on {lowConfTypes.join(" & ")}</span> — you've rated{" "}
          {lowConfTypes.map((t) => `${perTypeRated.get(t) ?? 0} ${t}`).join(", ")} so far. Rankings will sharpen once you're past {MIN_PER_TYPE} per type.{" "}
          <Link to="/rate" className="text-primary underline underline-offset-2">Rate more →</Link>
        </div>
      )}

      {showDecisionSurface && (
        <VerdictSurface
          rows={surfaceRows}
          pendingSkeletons={pendingSkeletons}
          stillReading={anyBatchInFlight}
          scannedAt={scannedAtMs}
          onRescan={startOver}
          boosted={boosted}
          onBoost={() => setBoosted((b) => !b)}
          controls={controls}
          setControls={setControls}
        />
      )}

      {showDecisionSurface && (
        <div className="mt-8 space-y-4">
          <CellarMemorySection matches={cellar.matches} predictionsByIndex={predictionsByIndex} />
          {autoAttributedTo && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sub">
              Added to <span className="font-medium">{autoAttributedTo}</span>.
            </div>
          )}
          {scanLogId && totalWines > 0 && !autoAttributedTo && <RestaurantAttribution scanId={scanLogId} />}
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
          <button onClick={startOver} className="mt-3 rounded-md bg-primary text-primary-foreground px-3 py-2 text-meta font-medium min-h-11">
            Re-scan
          </button>
        </div>
      )}

      {unreadable.length > 0 && (
        <div className="mt-8">
          <h2 className="font-serif text-base">Couldn't read these</h2>
          <ul className="mt-2 text-meta text-muted-foreground space-y-1">
            {unreadable.map((w, i) => (
              <li key={i}>{[w.producer, w.wine_name, w.vintage].filter(Boolean).join(" ") || "(illegible)"}</li>
            ))}
          </ul>
        </div>
      )}

      <SommelierBriefDialog open={sommOpen} onClose={() => setSommOpen(false)} />
    </div>
  );
}
