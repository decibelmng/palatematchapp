import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import {
  refingerprintV3Batch,
  refingerprintV3Progress,
} from "@/lib/refingerprint-v3.functions";

export const Route = createFileRoute("/admin/refingerprint-v3")({
  ssr: false,
  component: () => (
    <AuthGate>
      <RefingerprintV3 />
    </AuthGate>
  ),
});

/** The catalog_jobs row opened for this run. */
const JOB_ID = "fcf3b92a-0700-4a85-82a4-7d0d6b5af2a9";
const MODEL = "google/gemini-3.6-flash";

type Entry = { at: string; picked: number; wrote: number; empty: number; remaining: number };

function RefingerprintV3() {
  const runBatch = useServerFn(refingerprintV3Batch);
  const readProgress = useServerFn(refingerprintV3Progress);
  const [log, setLog] = useState<Entry[]>([]);
  const [progress, setProgress] = useState<{ scored: number; pending: number; thin: number; empty: number; ambiguous: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [jobId, setJobId] = useState(JOB_ID);
  const stop = useRef(false);

  useEffect(() => {
    readProgress().then(setProgress).catch((e) => setFatal(e?.message ?? String(e)));
  }, [readProgress]);

  async function loop() {
    if (!jobId) {
      setFatal("Paste the catalog_jobs id for this run first — every reading records its job.");
      return;
    }
    stop.current = false;
    setRunning(true);
    setFatal(null);
    try {
      while (!stop.current) {
        const res = await runBatch({ data: { jobId, model: MODEL } });
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
        if (res.errors.length > 0) setFatal(res.errors.join("\n"));
        if (res.picked === 0 || res.remaining <= 0) break;
      }
      setProgress(await readProgress());
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
