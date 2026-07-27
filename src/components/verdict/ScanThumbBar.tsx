import { ListControls } from "@/components/ListControls";
import { ServiceModeSwitch } from "@/components/ServiceModeSwitch";
import type { Controls, Priced } from "@/lib/list-controls";
import type { CurrencyCode } from "@/lib/currency";

/**
 * Docked toolbar at the base of the verdict surface.
 * Actions: re-scan · dark-restaurant-mode · list controls.
 */
export function ScanThumbBar({
  onRescan, controls, setControls, currency, rows,
}: {
  onRescan: () => void;
  controls: Controls;
  setControls: (c: Controls) => void;
  currency?: CurrencyCode;
  rows?: Priced[];
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
        <ServiceModeSwitch variant="icon" className="shrink-0" />
        <div className="flex-1 [&>div]:mt-0 [&>div]:justify-stretch [&_button]:w-full [&_button]:justify-center">
          <ListControls value={controls} onChange={setControls} idPrefix="scan-decision" currency={currency} rows={rows} />
        </div>
      </div>
    </div>
  );
}

