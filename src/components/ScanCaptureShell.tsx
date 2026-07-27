import { ScanLine, ArrowRight, Image as ImageIcon } from "lucide-react";
import type { RefObject } from "react";
import type { BatchState } from "@/lib/scan-helpers";

export function ScanEntryButtons({
  cameraRef, libraryRef, disabled, onPick,
}: {
  cameraRef: RefObject<HTMLInputElement | null>;
  libraryRef: RefObject<HTMLInputElement | null>;
  disabled: boolean;
  onPick: (files: FileList | null, el: HTMLInputElement | null) => void;
}) {
  return (
    <>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => onPick(e.target.files, e.currentTarget)} />
      <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => onPick(e.target.files, e.currentTarget)} />
      <button
        type="button"
        onClick={() => cameraRef.current?.click()}
        disabled={disabled}
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
        disabled={disabled}
        data-testid="scan-entry-library"
        className="mt-2 inline-flex items-center gap-1.5 text-meta text-muted-foreground hover:text-foreground disabled:opacity-60"
      >
        <ImageIcon size={14} /> Upload photos instead (up to 8 pages)
      </button>
    </>
  );
}

export function StagedPhotos({
  staged, isRunning, onRemove,
}: {
  staged: { file: File; url: string }[];
  isRunning: boolean;
  onRemove: (i: number) => void;
}) {
  if (staged.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {staged.map((s, i) => (
        <div key={s.url} className="relative">
          <img src={s.url} alt={`page ${i + 1}`} className="h-24 rounded-md border border-border object-cover" />
          {!isRunning && (
            <button onClick={() => onRemove(i)} aria-label={`Remove photo ${i + 1}`}
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-background border border-border text-meta leading-none flex items-center justify-center shadow">×</button>
          )}
        </div>
      ))}
    </div>
  );
}

export function BatchProgress({
  batches, isRunning, elapsed, onRetry,
}: {
  batches: BatchState[];
  isRunning: boolean;
  elapsed: number;
  onRetry: () => void;
}) {
  const failedBatches = batches.filter((b) => b.status === "failed");
  const anyInFlight = batches.some((b) => b.status === "running" || b.status === "pending");
  if (batches.length === 0 || (!isRunning && !anyInFlight && failedBatches.length === 0)) return null;
  return (
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
          <button onClick={onRetry}
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
  );
}
