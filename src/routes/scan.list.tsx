import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ListControls } from "@/components/ListControls";
import { DrinkingGroupSelector } from "@/components/DrinkingGroupSelector";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { useSession } from "@/hooks/use-session";
import { useGroupSelection, useGroupPredict, type GroupCandidateInput } from "@/hooks/use-friends";
import { recommend, type BottleFp, type RatedFp, type Recommendation, type WineType } from "@/lib/recommender";
import {
  createScanRecord,
  scanWineBatch,
  finalizeScan,
  loadRecentScan,
  type ResolvedWine,
} from "@/lib/scan.functions";
import { searchRestaurantsFn, createRestaurantFn, attributeScanFn } from "@/lib/restaurants.functions";
import { aggregateRated } from "@/lib/cuvee";
import { applyControls, normalizePrice, isGreatValue, DEFAULT_CONTROLS, type Controls, type Priced } from "@/lib/list-controls";
import type { GroupScored } from "@/lib/group.functions";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  const base64 = btoa(binary);
  let mt = file.type || "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(mt)) mt = "image/jpeg";
  return { base64, mediaType: mt };
}

type Ranked = Recommendation & { scanned: ResolvedWine };

type ScanRow = Priced & {
  key: string;
  ranked: Ranked;
  type: WineType;
  isCatalog: boolean;
  greatValue: boolean;
};

const TYPE_LABEL: Record<WineType, string> = {
  red: "Reds for you",
  white: "Whites for you",
  rose: "Rosés for you",
  sparkling: "Sparkling for you",
  dessert: "Dessert wines for you",
};

type BatchImage = { image_base64: string; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/heic" };
type BatchState = {
  index: number;
  pageNumbers: number[];
  status: "pending" | "running" | "done" | "failed";
  images: BatchImage[]; // kept in memory to allow same-session retry
  image_paths: string[];
  error?: string;
};

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function rowToResolved(r: any): ResolvedWine {
  return {
    producer: r.producer ?? null,
    wine_name: r.cuvee ?? null,
    vintage: r.vintage ?? null,
    region: r.region ?? null,
    grape: r.grape ?? null,
    price: r.price ?? null,
    type: (r.wine_type ?? null) as any,
    fp: null,
    confidence: null,
    fp_resolved: r.fp ?? null,
    fp_source: (r.fp_source ?? "estimated") as any,
    matched_bottle_id: r.matched_bottle_id ?? null,
    matched_bottle_name: null,
    match_score: r.match_score ?? 0,
    match_reasons: (r.match_reasons ?? []) as string[] | undefined,
  };
}

function Scan() {
  const session = useSession();
  const { data: ratings } = useRatings();
  const ratedIds = useMemo(() => (ratings ?? []).map((r) => r.bottle_id), [ratings]);
  const { data: ratedBottles } = useBottlesByIds(ratedIds);

  const createScan = useServerFn(createScanRecord);
  const runBatch = useServerFn(scanWineBatch);
  const finalize = useServerFn(finalizeScan);
  const loadRecent = useServerFn(loadRecentScan);

  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<{ file: File; url: string }[]>([]);
  const [elapsed, setElapsed] = useState(0);

  // Scan session state
  const [scanId, setScanId] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchState[]>([]);
  const [wines, setWines] = useState<ResolvedWine[]>([]);
  const [scanLogId, setScanLogId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "partial" | "complete" | "failed">("idle");
  const [resumedAt, setResumedAt] = useState<string | null>(null);
  const [dismissedResume, setDismissedResume] = useState(false);
  const finalizingRef = useRef(false);

  // Pre-scan restaurant selection (optional): stored here so `finalizeScan`
  // can auto-attribute without a second UI trip.
  const [prescanRestaurant, setPrescanRestaurant] = useState<{ id: string; name: string } | null>(null);
  const [autoAttributedTo, setAutoAttributedTo] = useState<string | null>(null);
  const attributeFn = useServerFn(attributeScanFn);

  const isRunning = status === "running";

  // ---------- Resume: hydrate any scan from the last 4h ----------
  const resumeQuery = useQuery({
    queryKey: ["recent-scan"],
    queryFn: () => loadRecent(),
    enabled: !!session,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!resumeQuery.data || scanId || dismissedResume) return;
    const { scan, wines: rows } = resumeQuery.data as any;
    if (!scan?.id) return;
    setScanId(scan.id);
    setResumedAt(scan.created_at);
    setWines((rows ?? []).map(rowToResolved));
    // Reconstruct minimal batch list (images gone after refresh, so no retry).
    const failed = new Set<number>(((scan.batches_failed ?? []) as number[]));
    const total = scan.batch_count ?? 0;
    const list: BatchState[] = [];
    for (let i = 0; i < total; i++) {
      list.push({
        index: i,
        pageNumbers: [i * 2 + 1, Math.min(scan.page_count, i * 2 + 2)].filter((n, idx, arr) => arr.indexOf(n) === idx),
        status: failed.has(i) ? "failed" : "done",
        images: [],
        image_paths: [],
      });
    }
    setBatches(list);
    setStatus(scan.status === "processing" ? "partial" : scan.status);
    // If the earlier session created a scan_log id (via finalizeScan), we can't easily recover it here.
    // Restaurant attribution requires a scan_log id; skip on resume unless a fresh finalize happens.
  }, [resumeQuery.data, scanId, dismissedResume]);

  // ---------- Kick off a fresh scan ----------
  const mutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (files.length === 0) throw new Error("Add at least one photo first.");
      const uid = session?.user.id;
      const scanUuid = crypto.randomUUID();

      // Upload originals + encode base64 for vision, in parallel.
      const prepared = await Promise.all(
        files.map(async (file, i) => {
          const { base64, mediaType } = await fileToBase64(file);
          let storagePath: string | null = null;
          if (uid) {
            const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
            const path = `${uid}/${scanUuid}/page-${i + 1}.${ext}`;
            const { error } = await supabase.storage
              .from("scan-images")
              .upload(path, file, { contentType: mediaType, upsert: true });
            if (!error) storagePath = path;
          }
          return {
            image_base64: base64,
            media_type: mediaType as BatchImage["media_type"],
            storagePath,
          };
        }),
      );

      const image_paths_all = prepared.map((p) => p.storagePath).filter((p): p is string => !!p);

      // Split into batches of 2 pages.
      const preparedBatches = chunk(prepared, 2);
      const created = await createScan({
        data: { page_count: files.length, batch_count: preparedBatches.length, image_paths: image_paths_all },
      });

      const initial: BatchState[] = preparedBatches.map((group, i) => ({
        index: i,
        pageNumbers: group.map((_, k) => i * 2 + k + 1),
        status: "pending",
        images: group.map((g) => ({ image_base64: g.image_base64, media_type: g.media_type })),
        image_paths: group.map((g) => g.storagePath).filter((p): p is string => !!p),
      }));

      setScanId(created.scan_id);
      setBatches(initial);
      setWines([]);
      setScanLogId(null);
      setStatus("running");
      setResumedAt(null);

      await runBatchesWithPool(created.scan_id, initial);
      return created.scan_id;
    },
    onError: (e) => {
      toast.error((e as Error).message ?? "Scan failed");
      setStatus("failed");
    },
  });

  async function runBatchesWithPool(sid: string, list: BatchState[]) {
    const concurrency = 3;
    const queue = list.map((b) => b.index);
    let cursor = 0;

    const runOne = async (index: number) => {
      const batch = list.find((b) => b.index === index)!;
      setBatches((prev) => prev.map((b) => (b.index === index ? { ...b, status: "running" } : b)));
      try {
        const res = await runBatch({
          data: {
            scan_id: sid,
            batch_index: index,
            images: batch.images,
            image_paths: batch.image_paths,
          },
        });
        setBatches((prev) => prev.map((b) => (b.index === index ? { ...b, status: "done", error: undefined } : b)));
        setWines((prev) => [...prev, ...res.wines]);
      } catch (e) {
        const msg = (e as Error).message ?? "Batch failed";
        setBatches((prev) => prev.map((b) => (b.index === index ? { ...b, status: "failed", error: msg } : b)));
      }
    };

    const workers: Promise<void>[] = [];
    const next = async () => {
      while (cursor < queue.length) {
        const idx = queue[cursor++];
        await runOne(idx);
      }
    };
    for (let w = 0; w < Math.min(concurrency, queue.length); w++) workers.push(next());
    await Promise.all(workers);

    // Finalize once
    if (finalizingRef.current) return;
    finalizingRef.current = true;
    try {
      const fin = await finalize({ data: { scan_id: sid } });
      setScanLogId(fin.scan_log_id ?? null);
      setStatus(fin.status as any);
      if (fin.status === "partial") toast.warning("Some pages didn't parse — retry them below.");
      else if (fin.status === "failed") toast.error("Scan failed — try again.");
      // Auto-attribute when the user picked a restaurant before scanning.
      if (fin.scan_log_id && prescanRestaurant) {
        try {
          const res = await attributeFn({ data: { scan_id: fin.scan_log_id, restaurant_id: prescanRestaurant.id } });
          setAutoAttributedTo(res.restaurant_name);
          toast.success(`Added to ${res.restaurant_name}`);
        } catch (e: any) {
          toast.error(e?.message ?? "Couldn't attribute to restaurant");
        }
      }
    } finally {
      finalizingRef.current = false;
    }
  }

  async function retryFailed() {
    if (!scanId) return;
    const failed = batches.filter((b) => b.status === "failed" && b.images.length > 0);
    if (failed.length === 0) {
      toast.error("Can't retry after refresh — start a new scan.");
      return;
    }
    setStatus("running");
    finalizingRef.current = false;
    await runBatchesWithPool(scanId, failed);
  }

  useEffect(() => {
    if (!isRunning) return;
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(id);
  }, [isRunning]);

  // ---------- Dedup, categorize ----------
  const dedupWines = useMemo(() => {
    const key = (w: ResolvedWine) =>
      [w.producer, w.wine_name, w.vintage ?? ""].map((s) => String(s ?? "").toLowerCase().trim()).join("|");
    const seen = new Set<string>();
    const out: ResolvedWine[] = [];
    for (const w of wines) {
      const k = key(w);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(w);
    }
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

  const ranked: Ranked[] = useMemo(() => {
    if (readable.length === 0) return [];
    const candidates: BottleFp[] = readable.map((w, i) => ({
      id: `scan-${i}`,
      name: [w.producer, w.wine_name, w.vintage].filter(Boolean).join(" ") || "Unknown wine",
      producer: w.producer ?? null,
      region: w.region ?? null,
      type: (w.type ?? "red") as WineType,
      fp: w.fp_resolved!,
    }));
    if (ratedRows.length === 0) {
      return candidates.map((b, i) => ({
        bottle: b, predicted: 0, nearest: null, maxSimilarity: 0, confidence: 0, scanned: readable[i],
      }));
    }
    const recs = recommend(ratedRows, candidates);
    const byId = new Map(readable.map((w, i) => [`scan-${i}`, w]));
    return recs.map((r) => ({ ...r, scanned: byId.get(r.bottle.id)! }));
  }, [readable, ratedRows]);

  const enoughRatings = ratedRows.length >= 3;

  const grouped: { type: WineType; rows: ScanRow[] }[] = useMemo(() => {
    const buckets = new Map<WineType, ScanRow[]>();
    ranked.forEach((r, i) => {
      const t = (r.scanned.type ?? "red") as WineType;
      const p = normalizePrice(r.scanned.price ?? null);
      const isCatalog = r.scanned.fp_source === "catalog";
      const row: ScanRow = {
        key: r.bottle.id + "-" + i,
        ranked: r,
        type: t,
        isCatalog,
        price_amount: p.amount,
        price_band: p.band,
        price_display: p.display,
        predicted: r.predicted,
        greatValue: false,
      };
      row.greatValue = isGreatValue(row);
      if (!buckets.has(t)) buckets.set(t, []);
      buckets.get(t)!.push(row);
    });
    const order: WineType[] = ["red", "white", "rose", "sparkling", "dessert"];
    return order.filter((t) => buckets.has(t)).map((t) => ({ type: t, rows: buckets.get(t)! }));
  }, [ranked]);

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

  function flagFor(r: Ranked): { label: string; tone: "good" | "bad" | "warn" } | null {
    if (!enoughRatings) return null;
    if (r.maxSimilarity < 0.35 || r.scanned.confidence === "low")
      return { label: "uncertain — unlike anything you've rated", tone: "warn" };
    if (r.predicted >= 3.8) return { label: "strong match", tone: "good" };
    if (r.predicted <= 2.6) return { label: "likely not your style", tone: "bad" };
    return null;
  }

  function onPick(fileList: FileList | null, inputEl: HTMLInputElement | null) {
    if (!fileList || fileList.length === 0) return;
    const incoming = Array.from(fileList);
    setStaged((prev) => {
      const next = [...prev];
      for (const f of incoming) {
        if (next.length >= 8) break;
        next.push({ file: f, url: URL.createObjectURL(f) });
      }
      return next;
    });
    if (inputEl) inputEl.value = "";
  }

  function removeAt(i: number) {
    setStaged((prev) => {
      const next = [...prev];
      const [removed] = next.splice(i, 1);
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
  }

  function startOver() {
    staged.forEach((s) => URL.revokeObjectURL(s.url));
    setStaged([]);
    setScanId(null);
    setBatches([]);
    setWines([]);
    setScanLogId(null);
    setStatus("idle");
    setResumedAt(null);
    setDismissedResume(true);
    mutation.reset();
  }

  function submit() {
    setDismissedResume(true);
    mutation.mutate(staged.map((s) => s.file));
  }

  const totalWines = dedupWines.length;
  const showResumeBanner = !!resumedAt && !!scanId && batches.length > 0 && staged.length === 0 && !dismissedResume;

  const failedBatches = batches.filter((b) => b.status === "failed");
  const anyBatchInFlight = batches.some((b) => b.status === "running" || b.status === "pending");

  return (
    <div className="pt-2">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Scan a list</p>
      <h1 className="font-serif text-3xl mt-2">Photograph a wine list</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        I'll read every wine on the list and rank them by predicted stars for your palate. Add as many
        photos as the list has pages (up to 8). Long lists are read in parallel — you'll see progress per page pair.
      </p>

      {showResumeBanner && (
        <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">Resuming your last scan · {new Date(resumedAt!).toLocaleTimeString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalWines} wine{totalWines === 1 ? "" : "s"} loaded from earlier today.
            </p>
          </div>
          <button
            onClick={startOver}
            className="shrink-0 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium"
          >
            Start a new scan
          </button>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => onPick(e.target.files, e.currentTarget)} />
        <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => onPick(e.target.files, e.currentTarget)} />
        <button onClick={() => cameraRef.current?.click()} disabled={isRunning || staged.length >= 8}
          className="rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium disabled:opacity-60">
          Take a photo
        </button>
        <button onClick={() => libraryRef.current?.click()} disabled={isRunning || staged.length >= 8}
          className="rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium disabled:opacity-60">
          Upload photos
        </button>
        {staged.length > 0 && (
          <button onClick={submit} disabled={isRunning}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-60">
            {isRunning ? "Reading…" : `Scan ${staged.length} photo${staged.length > 1 ? "s" : ""}`}
          </button>
        )}
        {(staged.length > 0 || scanId) && !isRunning && (
          <button onClick={startOver} className="rounded-md border border-border bg-card px-4 py-2.5 text-sm font-medium">
            Start over
          </button>
        )}
      </div>

      {staged.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {staged.map((s, i) => (
            <div key={s.url} className="relative">
              <img src={s.url} alt={`page ${i + 1}`} className="h-24 rounded-md border border-border object-cover" />
              {!isRunning && (
                <button onClick={() => removeAt(i)} aria-label={`Remove photo ${i + 1}`}
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-border text-xs leading-none flex items-center justify-center shadow">×</button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Per-batch progress */}
      {batches.length > 0 && (isRunning || anyBatchInFlight || failedBatches.length > 0) && (
        <div className="mt-4 rounded-md border border-border bg-card/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {isRunning ? "Reading pages…" : failedBatches.length > 0 ? "Some pages failed" : "Reading complete"}
            </p>
            {isRunning && <p className="text-[11px] text-muted-foreground">{elapsed}s</p>}
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {batches.map((b) => {
              const label = `Pages ${b.pageNumbers.join("–")}`;
              const icon =
                b.status === "done" ? "✓" :
                b.status === "failed" ? "✕" :
                b.status === "running" ? "…" : "·";
              const tone =
                b.status === "done" ? "text-primary" :
                b.status === "failed" ? "text-destructive" :
                b.status === "running" ? "text-foreground" : "text-muted-foreground";
              return (
                <li key={b.index} className={`flex items-center gap-2 ${tone}`}>
                  <span className="font-mono w-4 text-center">{icon}</span>
                  <span>{label}</span>
                  {b.status === "running" && (
                    <span aria-hidden className="inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent animate-spin" />
                  )}
                  {b.status === "failed" && b.error && (
                    <span className="text-[10px] text-muted-foreground truncate">— {b.error}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {failedBatches.length > 0 && !isRunning && (
            <div className="mt-3">
              <button onClick={retryFailed}
                className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium">
                Retry {failedBatches.length} failed page{failedBatches.length === 1 ? "" : "s"}
              </button>
              {failedBatches.some((b) => b.images.length === 0) && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Retry unavailable after refresh — start a new scan for the failed pages.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {mutation.isError && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
        </div>
      )}

      {!isRunning && status !== "idle" && readable.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          Couldn't read anything from those photos — try a clearer, straight-on shot in good light.
        </p>
      )}

      {!enoughRatings && readable.length > 0 && (
        <div className="mt-5 rounded-md border border-border bg-card/60 p-3 text-xs text-muted-foreground">
          Rate a few wines first so I can match this list to your taste. Showing the list in the order it was read.
        </div>
      )}

      {totalWines > 0 && (
        <div className="mt-5 rounded-md border border-border bg-card/60 p-3 text-xs text-muted-foreground">
          Read {totalWines} wine{totalWines > 1 ? "s" : ""} ·{" "}
          <span className="text-foreground">{matchedCount} matched the catalog</span> · {estimatedCount} estimated
          {unreadable.length > 0 ? ` · ${unreadable.length} unreadable` : ""}.
        </div>
      )}

      {totalWines === 1 && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Only one wine read — was this a <span className="font-medium">single bottle</span>?
          <div className="mt-2">
            <Link to="/scan/bottle" className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium">
              Switch to bottle scan →
            </Link>
          </div>
        </div>
      )}

      {scanLogId && totalWines > 0 && (
        <RestaurantAttribution scanId={scanLogId} />
      )}

      {grouped.length > 0 && (
        <div className="mt-6">
          <DrinkingGroupSelector
            selectedIds={group.friendIds}
            onToggle={group.toggle}
            onClear={group.clear}
            onSet={group.set}
          />
        </div>
      )}

      {grouped.length > 0 && (
        <div className="mt-6 space-y-8">
          {grouped.map((g) => (
            <ScanSection
              key={g.type}
              type={g.type}
              rows={g.rows}
              enoughRatings={enoughRatings}
              flagFor={flagFor}
              groupScores={groupScores}
              groupActive={groupActive}
              groupLoading={groupPred.isFetching}
            />
          ))}
        </div>
      )}

      {unreadable.length > 0 && (
        <div className="mt-8">
          <h2 className="font-serif text-base">Couldn't read these</h2>
          <ul className="mt-2 text-xs text-muted-foreground space-y-1">
            {unreadable.map((w, i) => (
              <li key={i}>{[w.producer, w.wine_name, w.vintage].filter(Boolean).join(" ") || "(illegible)"}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-10 text-[11px] text-muted-foreground">
        Long lists are read in parallel batches of 2 pages. Your photos and results are saved privately so a
        refresh, tab close, or dropped connection never loses a restaurant session.
      </p>
    </div>
  );
}

function RestaurantAttribution({ scanId }: { scanId: string }) {
  const searchFn = useServerFn(searchRestaurantsFn);
  const createFn = useServerFn(createRestaurantFn);
  const attributeFn = useServerFn(attributeScanFn);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [city, setCity] = useState("");
  const [attributed, setAttributed] = useState<{ name: string; id: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const results = useQuery({
    queryKey: ["restaurants", "search", debounced],
    enabled: debounced.length >= 2 && !attributed,
    queryFn: () => searchFn({ data: { q: debounced } }),
    staleTime: 30_000,
  });

  const attribute = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await attributeFn({ data: { scan_id: scanId, restaurant_id: id } });
      return { ...res, name };
    },
    onSuccess: (res) => {
      setAttributed({ id: res.restaurant_id, name: res.restaurant_name });
      toast.success(`Saved ${res.upserted} wine${res.upserted === 1 ? "" : "s"} to ${res.restaurant_name}`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't save"),
  });

  const createAndAttribute = useMutation({
    mutationFn: async (name: string) => {
      const created = await createFn({ data: { name, city: city.trim() || null } });
      const res = await attributeFn({ data: { scan_id: scanId, restaurant_id: created.id } });
      return { ...res, name: created.name };
    },
    onSuccess: (res) => {
      setAttributed({ id: res.restaurant_id, name: res.restaurant_name });
      toast.success(`Created ${res.restaurant_name} and saved ${res.upserted} wines`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't create restaurant"),
  });

  const busy = attribute.isPending || createAndAttribute.isPending;

  if (dismissed) return null;
  if (attributed) {
    return (
      <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
        <p className="text-foreground">Saved to <span className="font-medium">{attributed.name}</span>.</p>
        <Link to="/restaurants/$id" params={{ id: attributed.id }}
          className="mt-1 inline-block text-primary underline underline-offset-2">
          View restaurant page →
        </Link>
      </div>
    );
  }

  const showCreate = debounced.length >= 2 && results.data && results.data.length === 0;

  return (
    <div className="mt-4 rounded-md border border-border bg-card/70 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Where are you?</p>
          <p className="text-[11px] text-muted-foreground">Optional — attribute this list to a restaurant.</p>
        </div>
        <button onClick={() => setDismissed(true)}
          className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2">
          Skip
        </button>
      </div>
      <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Restaurant name…"
        disabled={busy}
        className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
      {results.data && results.data.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border overflow-hidden">
          {results.data.map((r) => (
            <li key={r.id}>
              <button disabled={busy} onClick={() => attribute.mutate({ id: r.id, name: r.name })}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent/60 disabled:opacity-60">
                <span className="font-medium">{r.name}</span>
                {r.city && <span className="text-muted-foreground"> · {r.city}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showCreate && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">No match — create it:</p>
          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (optional)"
            disabled={busy} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <button disabled={busy || !debounced} onClick={() => createAndAttribute.mutate(debounced)}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium disabled:opacity-60">
            {createAndAttribute.isPending ? "Creating…" : `Create "${debounced}"`}
          </button>
        </div>
      )}
      {busy && !createAndAttribute.isPending && (
        <p className="mt-2 text-[11px] text-muted-foreground">Saving…</p>
      )}
    </div>
  );
}

function ScanSection({
  type, rows, enoughRatings, flagFor, groupScores, groupActive, groupLoading,
}: {
  type: WineType;
  rows: ScanRow[];
  enoughRatings: boolean;
  flagFor: (r: Ranked) => { label: string; tone: "good" | "bad" | "warn" } | null;
  groupScores: Map<string, GroupScored> | null;
  groupActive: boolean;
  groupLoading: boolean;
}) {
  const [controls, setControls] = useState<Controls>(DEFAULT_CONTROLS);

  const overlaidRows: ScanRow[] = useMemo(() => {
    if (!groupActive || !groupScores) return rows;
    return rows.map((r) => {
      const g = groupScores.get(r.ranked.bottle.id);
      if (!g) return r;
      const next: ScanRow = { ...r, predicted: g.group_min };
      next.greatValue = isGreatValue(next);
      return next;
    });
  }, [rows, groupActive, groupScores]);

  const scoreAvailable = enoughRatings || groupActive;
  const effective: Controls = !scoreAvailable && (controls.sort === "best" || controls.sort === "value" || controls.sort === "confident")
    ? { ...controls, sort: "best" }
    : controls;
  const filtered = useMemo(() => {
    const out = applyControls(overlaidRows, effective);
    if (!scoreAvailable && effective.sort === "best") {
      const idx = new Map(overlaidRows.map((r, i) => [r.key, i]));
      return [...out].sort((a, b) => (idx.get(a.key) ?? 0) - (idx.get(b.key) ?? 0));
    }
    return out;
  }, [overlaidRows, effective, scoreAvailable]);
  const visible = filtered.slice(0, 40);
  const hidden = Math.max(0, filtered.length - visible.length);

  return (
    <section>
      <h2 className="font-serif text-xl">{TYPE_LABEL[type]}</h2>
      {groupActive && (
        <p className="mt-1 text-[11px] uppercase tracking-wider text-primary">
          Group picks · ranked by worst-case ★{groupLoading ? " · scoring…" : ""}
        </p>
      )}
      <ListControls value={controls} onChange={setControls} idPrefix={`scan-${type}`} />
      {visible.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No wines in this section match those filters.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {visible.map(({ ranked: r, isCatalog, greatValue, price_display }) => {
            const flag = groupActive ? null : flagFor(r);
            const g = groupActive && groupScores ? groupScores.get(r.bottle.id) ?? null : null;
            return (
              <li key={r.bottle.id} className="py-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium leading-tight truncate">{r.bottle.name}</p>
                    <span
                      className={`shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border ${
                        isCatalog ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-muted text-muted-foreground"
                      }`}
                      title={isCatalog ? `Matched: ${r.scanned.matched_bottle_name}` : "No catalog match — calibrated LLM estimate"}>
                      {isCatalog ? "catalog" : "estimated"}
                    </span>
                    {greatValue && (
                      <span className="shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                        great value
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {[r.bottle.region, r.scanned.grape, price_display].filter(Boolean).join(" · ")}
                  </p>
                  {g && (
                    <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                      {g.per_person.map((p, i) => (
                        <span key={p.user_id}>
                          {i > 0 && <span className="opacity-50"> · </span>}
                          <span className="text-foreground/80">{p.display_name}</span>{" "}
                          {p.predicted.toFixed(1)}
                          {p.still_learning && <span className="ml-0.5 opacity-70">(still learning)</span>}
                        </span>
                      ))}
                    </p>
                  )}
                  {!g && enoughRatings && r.nearest && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      like your {r.nearest.stars}★ <span className="text-foreground/80">{r.nearest.name}</span>
                    </p>
                  )}
                  {flag && (
                    <p className={`mt-1 text-[11px] ${
                      flag.tone === "good" ? "text-primary" :
                      flag.tone === "bad" ? "text-destructive" : "text-muted-foreground italic"
                    }`}>
                      {flag.label}
                    </p>
                  )}
                </div>
                {g ? (
                  <div className="shrink-0 text-right">
                    <span className="font-serif text-primary text-xl">{g.group_min.toFixed(1)}</span>
                    <span className="text-primary text-sm">★</span>
                    <p className="text-[10px] text-muted-foreground">avg {g.group_avg.toFixed(1)}</p>
                  </div>
                ) : enoughRatings ? (
                  <div className="shrink-0 text-right">
                    <span className="font-serif text-primary text-xl">{r.predicted.toFixed(1)}</span>
                    <span className="text-primary text-sm">★</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {hidden > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">+{hidden} more match these filters.</p>
      )}
    </section>
  );
}
