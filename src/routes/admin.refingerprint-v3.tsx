import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import {
  refingerprintV3Batch,
  refingerprintV3Progress,
} from "@/lib/refingerprint-v3.functions";
import {
  refingerprintV3NotelessBatch,
  refingerprintV3NotelessProgress,
} from "@/lib/refingerprint-v3-noteless.functions";

export const Route = createFileRoute("/admin/refingerprint-v3")({
  ssr: false,
  component: () => (
    <AuthGate>
      <RefingerprintV3 />
    </AuthGate>
  ),
});

/**
 * The 116 rows the main queue can never see: no recovered human review, so the
 * inner join on catalog_source_notes excludes them. Fourteen are wines the owner
 * has rated, which makes this tail a swap blocker rather than a follow-up.
 */
function NotelessTail({ jobId, mainPending }: { jobId: string; mainPending: number | null }) {
  const runBatch = useServerFn(refingerprintV3NotelessBatch);
  const readProgress = useServerFn(refingerprintV3NotelessProgress);
  const [state, setState] = useState<{ pending: number; done: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    readProgress().then(setState).catch(() => setState(null));
  }, [readProgress]);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      let guard = 0;
      while (guard++ < 12) {
        const res = await runBatch({ data: { jobId, model: MODEL, batchSize: 40, concurrency: 8 } });
        setMsg(
          `wrote ${res.wrote}/${res.picked}` +
            (res.notesGenerated > 0 ? `, ${res.notesGenerated} notes written` : "") +
            (res.errors.length > 0 ? `\n${res.errors.join("\n")}` : ""),
        );
        if (res.picked === 0) break;
      }
      setState(await readProgress());
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pm-card space-y-2 p-3">
      <h2 className="text-(length:--fs-body) font-medium text-(--text)">Wines with no review</h2>
      <p className="text-(length:--fs-meta) text-(--text-muted)">
        These have no recovered tasting note, so the main queue skips them. They are read from the
        note the wine already carries, or from one written for it — a weaker reading, recorded
        separately so it can be told apart later.
      </p>
      {state && (
        <p className="text-(length:--fs-meta) text-(--text)">
          {state.pending.toLocaleString()} left · {state.done.toLocaleString()} read this way
        </p>
      )}
      {mainPending != null && mainPending > 0 && (
        <p className="text-(length:--fs-meta) text-(--text)">
          Waiting on the main queue — {mainPending.toLocaleString()} wines left there. These are read
          last so they sit on the same model and prompt as everything else.
        </p>
      )}
      <button
        onClick={run}
        disabled={busy || !jobId || mainPending == null || mainPending > 0}
        className="min-h-[44px] w-full rounded-md border border-(--border-strong) px-4 text-(length:--fs-body) text-(--text) disabled:opacity-50"
      >
        {busy ? "Reading…" : "Read these"}
      </button>
      {msg && (
        <p className="whitespace-pre-wrap text-(length:--fs-meta) text-(--text-muted)">{msg}</p>
      )}
    </section>
  );
}

/** The catalog_jobs row opened for this run. */
const JOB_ID = "fcf3b92a-0700-4a85-82a4-7d0d6b5af2a9";
const MODEL = "google/gemini-3.6-flash";

/** No write for this long with rows outstanding = stalled, said out loud. */
const STALL_AFTER_MS = 5 * 60_000;

type Entry = { at: string; picked: number; wrote: number; empty: number; remaining: number };

function RefingerprintV3() {
  const runBatch = useServerFn(refingerprintV3Batch);
  const readProgress = useServerFn(refingerprintV3Progress);
  const [log, setLog] = useState<Entry[]>([]);
  const [progress, setProgress] = useState<{
    scored: number; pending: number; thin: number; empty: number; ambiguous: number;
    lastWriteAt: string | null;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [jobId, setJobId] = useState(JOB_ID);
  const stop = useRef(false);

  // Watchdog. The loop lives in this tab, so it dies with the tab, a sleeping
  // phone, or a dropped connection — and the previous run did exactly that at
  // 4,193 rows without saying so. This poll is deliberately INDEPENDENT of the
  // loop: it reads the newest shadow write straight from the catalog every 30s,
  // so it reports a stall whether the loop crashed, hung mid-batch, or was never
  // started. Silence with work outstanding is the thing worth surfacing.
  useEffect(() => {
    let alive = true;
    const read = () =>
      readProgress()
        .then((p) => { if (alive) setProgress(p); })
        .catch((e) => { if (alive) setFatal(e?.message ?? String(e)); });
    read();
    const poll = setInterval(read, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => { alive = false; clearInterval(poll); clearInterval(tick); };
  }, [readProgress]);

  const idleMs = progress?.lastWriteAt ? now - Date.parse(progress.lastWriteAt) : null;
  const stalled = idleMs != null && idleMs > STALL_AFTER_MS && (progress?.pending ?? 0) > 0;

  async function loop() {
    if (!jobId) {
      setFatal("Paste the catalog_jobs id for this run first — every reading records its job.");
      return;
    }
    stop.current = false;
    setRunning(true);
    setFatal(null);
    // A 3.6-hour run must not die on one bad round trip. Before this, a single
    // failed batch fetch — a dropped connection, a gateway 502, a cold worker —
    // escaped to the outer catch and ended the loop, which is exactly how the
    // note-less runner produced a blank screen. Now each batch is caught on its
    // own and the loop continues; only a sustained outage stops the run.
    let consecutive = 0;
    try {
      while (!stop.current) {
        // 60 rows per round trip, 16 lanes. Measured at 24 rows the loop ran
        // 7.4 rows/s — the ceiling was driver round-trip overhead between
        // batches, not gateway lanes. Per-row request shape is untouched, so
        // calibration is unaffected.
        let res: Awaited<ReturnType<typeof runBatch>>;
        try {
          res = await runBatch({
            data: { jobId, model: MODEL, batchSize: 60, concurrency: 16 },
          });
          consecutive = 0;
          setRetrying(null);
        } catch (e: any) {
          consecutive++;
          const msg = e?.message ?? String(e);
          if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
            setFatal(
              `Stopped after ${consecutive} failed batches in a row — last error: ${msg}. ` +
                `Nothing already written is lost; press Run to resume where it left off.`,
            );
            break;
          }
          // Backoff, then take the same slice again. Rows are only claimed by a
          // successful write, so a failed batch re-picks the identical ids.
          const waitMs = Math.min(30_000, 2_000 * 2 ** (consecutive - 1));
          setRetrying(`Batch failed (${msg}) — retry ${consecutive} in ${waitMs / 1000}s`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        setLog((l) =>
          [
            {
              at: new Date().toLocaleTimeString(),
              picked: res.picked,
              wrote: res.wrote,
              empty: res.empty,
              remaining: res.remaining,
            },
            ...l,
          ].slice(0, 60),
        );
        // Per-row failures inside a batch are reported without stopping — the
        // handler already retries each row three times and drains the rest.
        if (res.errors.length > 0) setFatal(res.errors.join("\n"));
        if (res.picked === 0 || res.remaining <= 0) break;
      }
      setProgress(await readProgress());
    } catch (e: any) {
      setFatal(e?.message ?? String(e));
    } finally {
      setRetrying(null);
      setRunning(false);
    }
  }


  /** One batch, then stop. Used to meter cost and wall-clock before the run. */
  async function once() {
    if (!jobId) {
      setFatal("Paste the catalog_jobs id for this run first — every reading records its job.");
      return;
    }
    setRunning(true);
    setFatal(null);
    const t0 = Date.now();
    try {
      const res = await runBatch({ data: { jobId, model: MODEL } });
      setLog((l) =>
        [
          {
            at: `${new Date().toLocaleTimeString()} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
            picked: res.picked,
            wrote: res.wrote,
            empty: res.empty,
            remaining: res.remaining,
          },
          ...l,
        ].slice(0, 60),
      );
      if (res.errors.length > 0) setFatal(res.errors.join("\n"));
      setProgress(await readProgress());
      (window as unknown as Record<string, unknown>).__v3Once = { ...res, ms: Date.now() - t0 };
    } catch (e: any) {
      setFatal(e?.message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-(length:--fs-title) font-semibold text-(--text)">Catalog re-read (v3)</h1>
        <p className="text-(length:--fs-meta) text-(--text-muted)">
          Writes shadow columns only. Nothing the app reads changes until the swap. Safe to
          interrupt — unwritten rows stay pending and the next run picks them up.
        </p>
      </header>

      <label className="block space-y-1">
        <span className="text-(length:--fs-meta) text-(--text-muted)">catalog_jobs id</span>
        <input
          value={jobId}
          onChange={(e) => setJobId(e.target.value.trim())}
          placeholder="uuid"
          className="pm-card w-full px-3 py-2 text-(length:--fs-body) text-(--text)"
        />
      </label>

      {progress && (
        <div className="pm-card grid grid-cols-2 gap-2 p-3 text-(length:--fs-meta) text-(--text)">
          <div>Read: {progress.scored.toLocaleString()}</div>
          <div>Pending: {progress.pending.toLocaleString()}</div>
          <div>Thin (≤3 axes): {progress.thin.toLocaleString()}</div>
          <div>Unreadable: {progress.empty.toLocaleString()}</div>
          <div>Ambiguous join: {progress.ambiguous.toLocaleString()}</div>

        </div>
      )}

      {stalled && (
        <div className="pm-card space-y-1 border-(--amber) p-3">
          <p className="text-(length:--fs-body) font-medium text-(--text)">
            Stalled — nothing written for {Math.floor((idleMs ?? 0) / 60_000)} minutes
          </p>
          <p className="text-(length:--fs-meta) text-(--text-muted)">
            {(progress?.pending ?? 0).toLocaleString()} wines are still waiting. Press Run until done
            to pick up where it stopped — no reading is lost and nothing is read twice.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={loop}
          disabled={running}
          className="min-h-[44px] flex-1 rounded-md bg-(--accent) px-4 text-(length:--fs-body) font-medium text-(--accent-fg) disabled:opacity-50"
        >
          {running ? "Reading…" : "Run until done"}
        </button>
        <button
          onClick={once}
          disabled={running}
          className="min-h-[44px] rounded-md border border-(--border-strong) px-4 text-(length:--fs-body) text-(--text) disabled:opacity-50"
        >
          One batch
        </button>
        <button
          onClick={() => {
            stop.current = true;
          }}
          disabled={!running}
          className="min-h-[44px] rounded-md border border-(--border-strong) px-4 text-(length:--fs-body) text-(--text) disabled:opacity-50"
        >
          Stop
        </button>
      </div>

      {fatal && (
        <p className="pm-card whitespace-pre-wrap p-3 text-(length:--fs-meta) text-(--text)">{fatal}</p>
      )}

      <NotelessTail jobId={jobId} mainPending={progress?.pending ?? null} />

      <ul className="space-y-1 text-(length:--fs-meta) text-(--text-muted)">
        {log.map((e, i) => (
          <li key={i}>
            {e.at} — wrote {e.wrote}/{e.picked}
            {e.empty > 0 ? `, ${e.empty} unreadable` : ""}, {e.remaining.toLocaleString()} left
          </li>
        ))}
      </ul>
    </div>
  );
}
