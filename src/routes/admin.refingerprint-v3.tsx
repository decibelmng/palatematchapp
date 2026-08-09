import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import {
  refingerprintV3Progress,
  refingerprintV3SetPaused,
} from "@/lib/refingerprint-v3.functions";
import {
  refingerprintV3NotelessBatch,
  refingerprintV3NotelessProgress,
} from "@/lib/refingerprint-v3-noteless.functions";

const JOB_ID = "fcf3b92a-0700-4a85-82a4-7d0d6b5af2a9";
const MODEL = "google/gemini-3.6-flash";
const STALL_AFTER_MS = 5 * 60_000;

type Progress = {
  scored: number;
  pending: number;
  thin: number;
  empty: number;
  ambiguous: number;
  wrote1m: number;
  wrote5m: number;
  rowsPerSecond: number;
  lastWriteAt: string | null;
  paused: boolean;
};

export const Route = createFileRoute("/admin/refingerprint-v3")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Catalog re-read monitor | Palate Match" },
      { name: "description", content: "Monitor the unattended catalog re-read." },
      { property: "og:title", content: "Catalog re-read monitor | Palate Match" },
      { property: "og:description", content: "Monitor the unattended catalog re-read." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AuthGate>
      <RefingerprintV3Monitor />
    </AuthGate>
  ),
});

function NotelessTail({ mainPending }: { mainPending: number | null }) {
  const runBatch = useServerFn(refingerprintV3NotelessBatch);
  const readProgress = useServerFn(refingerprintV3NotelessProgress);
  const [state, setState] = useState<{ pending: number; done: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    readProgress().then(setState).catch(() => setState(null));
  }, [readProgress]);

  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      let guard = 0;
      while (guard++ < 12) {
        const result = await runBatch({
          data: { jobId: JOB_ID, model: MODEL, batchSize: 40, concurrency: 8 },
        });
        setMessage(
          `wrote ${result.wrote}/${result.picked}` +
            (result.notesGenerated > 0 ? `, ${result.notesGenerated} notes written` : "") +
            (result.errors.length > 0 ? `\n${result.errors.join("\n")}` : ""),
        );
        if (result.picked === 0) break;
      }
      setState(await readProgress());
    } catch (error: any) {
      setMessage(error?.message ?? String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pm-card space-y-2 p-3">
      <h2 className="text-(length:--fs-body) font-medium text-(--text)">Wines with no review</h2>
      <p className="text-(length:--fs-meta) text-(--text-muted)">
        These are read last from the note the wine already carries, or from one written for it.
      </p>
      {state && (
        <p className="text-(length:--fs-meta) text-(--text)">
          {state.pending.toLocaleString()} left · {state.done.toLocaleString()} read this way
        </p>
      )}
      {mainPending != null && mainPending > 0 && (
        <p className="text-(length:--fs-meta) text-(--text)">
          Waiting on the main queue — {mainPending.toLocaleString()} wines left.
        </p>
      )}
      <button
        onClick={run}
        disabled={busy || mainPending == null || mainPending > 0}
        className="min-h-[44px] w-full rounded-md border border-(--border-strong) px-4 text-(length:--fs-body) text-(--text) disabled:opacity-50"
      >
        {busy ? "Reading…" : "Read these"}
      </button>
      {message && (
        <p className="whitespace-pre-wrap text-(length:--fs-meta) text-(--text-muted)">{message}</p>
      )}
    </section>
  );
}

function RefingerprintV3Monitor() {
  const readProgress = useServerFn(refingerprintV3Progress);
  const setPaused = useServerFn(refingerprintV3SetPaused);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = () =>
      readProgress()
        .then((value) => {
          if (alive) {
            setProgress(value);
            setError(null);
          }
        })
        .catch((reason) => {
          if (alive) setError(reason?.message ?? String(reason));
        });
    read();
    const poll = setInterval(read, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [readProgress]);

  const idleMs = progress?.lastWriteAt ? now - Date.parse(progress.lastWriteAt) : null;
  const stalled =
    !progress?.paused &&
    idleMs != null &&
    idleMs > STALL_AFTER_MS &&
    (progress?.pending ?? 0) > 0;

  async function togglePaused() {
    if (!progress) return;
    setPauseBusy(true);
    setError(null);
    try {
      await setPaused({ data: { jobId: JOB_ID, paused: !progress.paused } });
      setProgress(await readProgress());
    } catch (reason: any) {
      setError(reason?.message ?? String(reason));
    } finally {
      setPauseBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-(length:--fs-title) font-semibold text-(--text)">
          Catalog re-read monitor
        </h1>
        <p className="text-(length:--fs-meta) text-(--text-muted)">
          The scheduled runner works independently of this page and writes shadow columns only.
        </p>
      </header>

      {progress && (
        <section className="pm-card grid grid-cols-2 gap-2 p-3 text-(length:--fs-meta) text-(--text)">
          <div>Read: {progress.scored.toLocaleString()}</div>
          <div>Pending: {progress.pending.toLocaleString()}</div>
          <div>Thin (≤3 axes): {progress.thin.toLocaleString()}</div>
          <div>Unreadable: {progress.empty.toLocaleString()}</div>
          <div>Ambiguous join: {progress.ambiguous.toLocaleString()}</div>
          <div>Last minute: {progress.wrote1m.toLocaleString()}</div>
          <div>Five-minute rate: {progress.rowsPerSecond.toFixed(1)}/s</div>
          <div>Status: {progress.pending === 0 ? "Complete" : progress.paused ? "Paused" : "Scheduled"}</div>
        </section>
      )}

      {stalled && (
        <section className="pm-card space-y-1 border-(--amber) p-3">
          <p className="text-(length:--fs-body) font-medium text-(--text)">
            Stalled — nothing written for {Math.floor((idleMs ?? 0) / 60_000)} minutes
          </p>
          <p className="text-(length:--fs-meta) text-(--text-muted)">
            The next scheduled invocation will retry the oldest waiting rows.
          </p>
        </section>
      )}

      <button
        onClick={togglePaused}
        disabled={pauseBusy || !progress || progress.pending === 0}
        className="min-h-[44px] w-full rounded-md border border-(--border-strong) px-4 text-(length:--fs-body) text-(--text) disabled:opacity-50"
      >
        {pauseBusy ? "Saving…" : progress?.paused ? "Resume scheduled runner" : "Pause scheduled runner"}
      </button>

      {error && (
        <p className="pm-card whitespace-pre-wrap p-3 text-(length:--fs-meta) text-(--text)">{error}</p>
      )}

      <NotelessTail mainPending={progress?.pending ?? null} />
    </main>
  );
}