import { ListControls } from "@/components/ListControls";
import type { Controls } from "@/lib/list-controls";

export function ScanThumbBar({
  boosted, onBoost, onRescan, controls, setControls,
}: {
  boosted: boolean;
  onBoost: () => void;
  onRescan: () => void;
  controls: Controls;
  setControls: (c: Controls) => void;
}) {
  return (
    <div className="mt-6 rounded-xl border border-border bg-card" role="toolbar" aria-label="Scan result actions">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onRescan}
          aria-label="Re-scan"
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-foreground text-sub font-medium min-h-11 px-3 whitespace-nowrap overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:bg-accent"
        >
          <span aria-hidden>↻</span>
          <span className="truncate">Re-scan</span>
        </button>
        <button
          type="button"
          onClick={onBoost}
          aria-pressed={boosted}
          aria-label={boosted ? "Turn brightness boost off" : "Turn brightness boost on"}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border text-sub font-medium min-h-11 px-3 whitespace-nowrap overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
            boosted
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-foreground active:bg-accent"
          }`}
        >
          <span aria-hidden>☀</span>
          <span className="truncate">{boosted ? "Boost on" : "Boost"}</span>
        </button>
        <div className="flex-1 [&>div]:mt-0 [&>div]:justify-stretch [&_button]:w-full [&_button]:justify-center">
          <ListControls value={controls} onChange={setControls} idPrefix="scan-decision" />
        </div>
      </div>
    </div>
  );
}
