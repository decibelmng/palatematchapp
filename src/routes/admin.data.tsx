import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef } from "react";
import { refingerprintBatch, refingerprintMyMatchesBatch } from "@/lib/admin-refingerprint.functions";

export const Route = createFileRoute("/admin/data")({
  ssr: false,
  component: () => <AuthGate><AdminData /></AuthGate>,
});

type LogEntry = { at: string; processed: number; skipped: number; remaining: number; errors?: string[] };

function AdminData() {
  const run = useServerFn(refingerprintBatch);
  const runMatches = useServerFn(refingerprintMyMatchesBatch);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [loop, setLoop] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const loopRef = useRef(false);
  const [mode, setMode] = useState<"all" | "matches">("all");

  async function once(which: "all" | "matches" = mode) {
    setMode(which);
    setBusy(true);
    try {
      const res = which === "matches" ? await runMatches() : await run();
      const entry: LogEntry = {
        at: new Date().toLocaleTimeString(),
        processed: res.processed,
        skipped: res.skipped,
        remaining: res.remaining,
        errors: res.errors,
      };
      setLog((l) => [entry, ...l].slice(0, 50));
      return res;
    } catch (e: any) {
      setFatal(e?.message ?? String(e));
      loopRef.current = false;
      setLoop(false);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function runUntilDone(which: "all" | "matches") {
    setMode(which);
    loopRef.current = true;
    setLoop(true);
    setFatal(null);
    while (loopRef.current) {
      const res = await once(which);
      if (!res) break;
      if (res.remaining <= 0) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    loopRef.current = false;
    setLoop(false);
  }

  function stopLoop() {
    loopRef.current = false;
    setLoop(false);
  }

  if (fatal === "Not authorized") {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <p>Not authorized.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 720 }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Cuvée re-fingerprinting</h1>
      <p style={{ opacity: 0.7, fontSize: 13, marginBottom: 16 }}>
        Processes up to 15 unstamped cuvée groups per click. Priority: rated → on a menu → fully defaulted.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => once("all")}
          disabled={busy || loop}
          style={{ padding: "8px 12px", border: "1px solid #999", borderRadius: 6 }}
        >
          {busy && !loop && mode === "all" ? "Working…" : "Re-fingerprint next 15 cuvées"}
        </button>
        <button
          onClick={() => once("matches")}
          disabled={busy || loop}
          style={{ padding: "8px 12px", border: "1px solid #999", borderRadius: 6 }}
        >
          {busy && !loop && mode === "matches" ? "Working…" : "Re-score my current matches"}
        </button>
        {!loop ? (
          <>
            <button
              onClick={() => runUntilDone("all")}
              disabled={busy}
              style={{ padding: "8px 12px", border: "1px solid #999", borderRadius: 6 }}
            >
              Run until done (all)
            </button>
            <button
              onClick={() => runUntilDone("matches")}
              disabled={busy}
              style={{ padding: "8px 12px", border: "1px solid #999", borderRadius: 6 }}
            >
              Run until done (matches)
            </button>
          </>
        ) : (
          <button
            onClick={stopLoop}
            style={{ padding: "8px 12px", border: "1px solid #c33", borderRadius: 6 }}
          >
            Stop
          </button>
        )}
      </div>
      {fatal && fatal !== "Not authorized" && (
        <div style={{ padding: 12, border: "1px solid #c33", borderRadius: 6, marginBottom: 16, color: "#c33" }}>
          {fatal}
        </div>
      )}
      <div style={{ fontSize: 13, fontFamily: "ui-monospace, monospace" }}>
        {log.map((e, i) => (
          <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #eee" }}>
            [{e.at}] processed={e.processed} skipped={e.skipped} remaining={e.remaining}
            {e.errors && e.errors.length > 0 && (
              <div style={{ opacity: 0.6, paddingLeft: 12 }}>
                {e.errors.map((er, j) => <div key={j}>· {er}</div>)}
              </div>
            )}
          </div>
        ))}
        {log.length === 0 && <div style={{ opacity: 0.5 }}>No runs yet.</div>}
      </div>
    </div>
  );
}
