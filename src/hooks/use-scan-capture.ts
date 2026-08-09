import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import {
  createScanRecord,
  scanWineBatch,
  finalizeScan,
  loadRecentScan,
  type ResolvedWine,
} from "@/lib/scan.functions";
import { attributeScanToVenueFn } from "@/lib/restaurants.functions";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import {
  chunkArr,
  rowToResolved,
  type BatchImage,
  type BatchState,
} from "@/lib/scan-helpers";
import { prepareImageForScan } from "@/lib/image-downscale";

export type ScanStatus = "idle" | "running" | "partial" | "complete" | "failed";

/** Client-side per-batch deadline. Longer than the server's own 60s + 45s
 *  retry budget on purpose — see the comment at the race below. */
const BATCH_DEADLINE_MS = 150_000;

/** After this long with no new wine landing, the screen says so and offers a
 *  way out. A running scan must never be a dead end. */
export const STALL_AFTER_MS = 15_000;

export function useScanCapture() {
  const session = useSession();

  const createScan = useServerFn(createScanRecord);
  const runBatch = useServerFn(scanWineBatch);
  const finalize = useServerFn(finalizeScan);
  const loadRecent = useServerFn(loadRecentScan);
  const attributeVenueFn = useServerFn(attributeScanToVenueFn);

  const [staged, setStaged] = useState<{ file: File; url: string }[]>([]);
  const [scanId, setScanId] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchState[]>([]);
  const [wines, setWines] = useState<ResolvedWine[]>([]);
  const [scanLogId, setScanLogId] = useState<string | null>(null);
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [resumedAt, setResumedAt] = useState<string | null>(null);
  const [dismissedResume, setDismissedResume] = useState(false);
  const [prescanRestaurant, setPrescanRestaurant] = useState<{ id: string; name: string } | null>(null);
  const [autoAttributedTo, setAutoAttributedTo] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stalled, setStalled] = useState(false);
  const finalizingRef = useRef(false);
  /** Timestamp of the last real progress (a wine landed, or a batch settled).
   *  A ref so the ticking interval never has to restart to see it. */
  const progressRef = useRef(Date.now());

  const isRunning = status === "running";

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
  }, [resumeQuery.data, scanId, dismissedResume]);

  const runBatchesWithPool = useCallback(async (sid: string, list: BatchState[]) => {
    const concurrency = 3;
    const queue = list.map((b) => b.index);
    let cursor = 0;

    const runOne = async (index: number) => {
      const batch = list.find((b) => b.index === index)!;
      setBatches((prev) => prev.map((b) => (b.index === index ? { ...b, status: "running" } : b)));
      try {
        // Hard per-batch deadline. The server's own budget is 60s + a 45s
        // retry = 105s worst case, so this MUST be longer or we would abandon
        // a request that was still going to succeed. A severed request (the
        // 499 hang) now resolves here as a failed batch instead of a batch
        // that stays "running" forever with no exit.
        const res = await Promise.race([
          runBatch({
            data: {
              scan_id: sid,
              batch_index: index,
              images: batch.images,
              image_paths: batch.image_paths,
            },
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("That page took too long to read.")), BATCH_DEADLINE_MS),
          ),
        ]);
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

    if (finalizingRef.current) return;
    finalizingRef.current = true;
    try {
      const fin = await finalize({ data: { scan_id: sid } });
      setScanLogId(fin.scan_log_id ?? null);
      setStatus(fin.status as any);
      if (fin.status === "partial") toast.warning("Some pages didn't parse — retry them below.");
      else if (fin.status === "failed") toast.error("Scan failed — try again.");
      if (fin.restaurant_id && prescanRestaurant) {
        setAutoAttributedTo(prescanRestaurant.name);
      } else if (prescanRestaurant) {
        // Creation-time write missed (older row, resumed scan) — attribute now
        // against the scan row so the fact capture still runs.
        try {
          const res = await attributeVenueFn({
            data: { scan_id: sid, restaurant_id: prescanRestaurant.id, scan_log_id: fin.scan_log_id ?? null },
          });
          setAutoAttributedTo(res.restaurant_name);
        } catch (e) {
          toast.error(friendlyError(e, "Couldn't save the venue"));
        }
      }
    } finally {
      finalizingRef.current = false;
    }
  }, [runBatch, finalize, attributeVenueFn, prescanRestaurant]);

  const mutation = useMutation({
    mutationFn: async (files: File[]) => {
      if (files.length === 0) throw new Error("Add at least one photo first.");
      const uid = session?.user.id;
      if (!uid) throw new Error("You're signed out — sign in again and re-take the photo.");
      const scanUuid = crypto.randomUUID();

      // Every stage names itself in the thrown message. A scan that dies
      // before the first insert leaves no database row at all, so the stage
      // label is the ONLY evidence of where it died.
      const stage = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
        try {
          return await fn();
        } catch (e) {
          const msg = (e as Error)?.message ?? String(e);
          console.error(`[scan] ${label} failed: ${msg}`, e);
          throw new Error(`${label}: ${msg}`);
        }
      };

      const prepared = await Promise.all(
        files.map(async (file, i) => {
          const img = await stage(`Preparing photo ${i + 1}`, () => prepareImageForScan(file));
          const ext = img.mediaType === "image/png" ? "png" : img.mediaType === "image/webp" ? "webp" : "jpg";
          const path = `${uid}/${scanUuid}/page-${i + 1}.${ext}`;
          // Fire-and-forget, exactly like the bottle path. A slow or hanging
          // upload must never sit in front of the scan insert — the scan ships
          // base64 to the model anyway; the stored copy is only for re-opening.
          void supabase.storage
            .from("scan-images")
            .upload(path, img.blob, { contentType: img.mediaType, upsert: true })
            .then(({ error }) => {
              if (error) console.error(`[scan] photo ${i + 1} upload failed: ${error.message}`);
            })
            .catch((e) => console.error(`[scan] photo ${i + 1} upload threw`, e));
          return {
            image_base64: img.base64,
            media_type: img.mediaType as BatchImage["media_type"],
            storagePath: path,
          };
        }),
      );

      const image_paths_all = prepared.map((p) => p.storagePath).filter((p): p is string => !!p);
      const preparedBatches = chunkArr(prepared, 2);
      const created = await stage("Starting the scan", () => createScan({
        data: {
          page_count: files.length,
          batch_count: preparedBatches.length,
          image_paths: image_paths_all,
          // Optional attribution. The server drops it if it doesn't resolve,
          // so it can never fail the insert.
          restaurant_id: prescanRestaurant?.id ?? null,
        },
      }));



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
    onError: () => {
      // No toast: the scan screen renders exactly ONE error surface
      // (ScanStateMessage), driven off status/mutation.error. A toast here
      // produced a second, differently-worded failure message.
      setStatus("failed");
    },
  });

  const retryFailed = useCallback(async () => {
    if (!scanId) return;
    const failed = batches.filter((b) => b.status === "failed" && b.images.length > 0);
    if (failed.length === 0) {
      toast.error("Can't retry after refresh — start a new scan.");
      return;
    }
    setStatus("running");
    finalizingRef.current = false;
    await runBatchesWithPool(scanId, failed);
  }, [scanId, batches, runBatchesWithPool]);

  const startOver = useCallback(() => {
    staged.forEach((s) => URL.revokeObjectURL(s.url));
    setStaged([]);
    setScanId(null);
    setBatches([]);
    setWines([]);
    setScanLogId(null);
    setStatus("idle");
    setResumedAt(null);
    setDismissedResume(true);
    setPrescanRestaurant(null);
    setAutoAttributedTo(null);
    mutation.reset();
  }, [staged, mutation]);

  /** Hard reset before a new attempt. Errors, resume banners, partial results
   *  and prior batches from a previous attempt never survive into a new one. */
  const beginNewScan = useCallback(() => {
    setStaged((prev) => { prev.forEach((s) => URL.revokeObjectURL(s.url)); return []; });
    setScanId(null);
    setBatches([]);
    setWines([]);
    setScanLogId(null);
    setStatus("idle");
    setResumedAt(null);
    setDismissedResume(true);
    setAutoAttributedTo(null);
    mutation.reset();
  }, [mutation]);

  /** Stage File objects handed over from the SCAN chooser sheet. */
  const addFileObjects = useCallback((files: File[]) => {
    if (files.length === 0) return;
    setStaged((prev) => {
      const next = [...prev];
      for (const f of files) {
        if (next.length >= 8) break;
        next.push({ file: f, url: URL.createObjectURL(f) });
      }
      return next;
    });
  }, []);

  const addFiles = useCallback((fileList: FileList | null, inputEl: HTMLInputElement | null) => {
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
  }, []);

  const removeAt = useCallback((i: number) => {
    setStaged((prev) => {
      const next = [...prev];
      const [removed] = next.splice(i, 1);
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
  }, []);

  const submit = useCallback(() => {
    setDismissedResume(true);
    mutation.mutate(staged.map((s) => s.file));
  }, [mutation, staged]);

  // Any wine landing or any batch settling counts as progress and resets the
  // stall clock — so "no progress for 15s" means exactly that, not "15s in".
  const settledCount = batches.filter((b) => b.status === "done" || b.status === "failed").length;
  useEffect(() => {
    progressRef.current = Date.now();
    setStalled(false);
  }, [wines.length, settledCount, status]);

  useEffect(() => {
    if (!isRunning) { setStalled(false); return; }
    setElapsed(0);
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
      setStalled(Date.now() - progressRef.current > STALL_AFTER_MS);
    }, 250);
    return () => clearInterval(id);
  }, [isRunning]);

  /** "Read what we have so far." Finalizes the scan against whatever landed,
   *  so a stalled read is an inconvenience with an exit, not a dead end. */
  const readSoFar = useCallback(async () => {
    if (!scanId) return;
    setStalled(false);
    try {
      const fin = await finalize({ data: { scan_id: scanId } });
      setScanLogId(fin.scan_log_id ?? null);
      setStatus(wines.length > 0 ? "partial" : "failed");
      void fin;
    } catch (e) {
      toast.error(friendlyError(e, "Couldn't wrap up that scan"));
      setStatus(wines.length > 0 ? "partial" : "failed");
    }
  }, [scanId, finalize, wines.length]);

  return {
    // state
    staged, wines, batches, scanId, scanLogId, status, isRunning,
    resumedAt, dismissedResume, prescanRestaurant, autoAttributedTo, elapsed, stalled,
    mutation,
    // setters
    setPrescanRestaurant, setDismissedResume,
    // actions
    addFiles, addFileObjects, removeAt, submit, retryFailed, startOver, beginNewScan, readSoFar,
  };
}
