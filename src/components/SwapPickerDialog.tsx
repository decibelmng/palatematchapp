import { useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useEligibleSwapCandidates } from "@/hooks/use-swap-candidates";
import { usePromoteCanon, usePromoteNemesis, type BenchmarkTier } from "@/hooks/use-canon";
import type { BottleRow } from "@/hooks/use-palate-data";
import { useGenericWarning } from "@/hooks/use-generic-warning";
import { WineTypeBadge } from "@/components/WineTypeBadge";

type Props = {
  open: boolean;
  onClose: () => void;
  tier: BenchmarkTier;
  region: string;      // display value (canon.region)
  regionKey: string;   // lowercase key (canon.region_key)
  wineType: string;
  currentBottle: BottleRow;
  /** Called with the newly-promoted bottle so the parent can arm undo. */
  onSwapped: (newBottle: BottleRow, previousBottle: BottleRow) => void;
};

/**
 * Modal picker for swapping the active Canon/Nemesis in a (region, type) slot.
 * Lists the user's other star-eligible ratings in the same region; selecting
 * one calls `set_benchmark` (via usePromoteCanon/Nemesis) which atomically
 * demotes the current benchmark and installs the new one.
 */
export function SwapPickerDialog({
  open, onClose, tier, region, regionKey, wineType, currentBottle, onSwapped,
}: Props) {
  const promoteCanon = usePromoteCanon();
  const promoteNemesis = usePromoteNemesis();
  const promote = tier === "canon" ? promoteCanon : promoteNemesis;
  const genericWarning = useGenericWarning();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pickInFlight = useRef(false);

  const { data: candidates, isLoading } = useEligibleSwapCandidates({
    tier,
    regionKey,
    wineType,
    excludeBottleId: currentBottle.id,
    enabled: open,
  });

  if (!open) return null;

  const tierLabel = tier === "canon" ? "Canon" : "Nemesis";
  const starHint = tier === "canon" ? "5★" : "1–2★";

  const handlePick = async (b: BottleRow) => {
    if (pickInFlight.current || promote.isPending) return;
    pickInFlight.current = true;
    setPendingId(b.id);
    try {
      const ok = await genericWarning.confirmIfGeneric(b);
      if (!ok) return;
      const result = await promote.mutateAsync({ bottle: b });
      if (result.replaced_id === null) {
        toast(`${tierLabel} already set to ${b.name}.`);
        return;
      }
      onSwapped(b, currentBottle);
      onClose();
    } catch (err) {
      const msg = (err as Error).message || `Couldn't swap ${tierLabel}`;
      toast.error(msg);
    } finally {
      pickInFlight.current = false;
      setPendingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="swap-picker-title"
        className="w-full sm:max-w-lg max-h-[85vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-card border border-border shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 p-4 border-b border-border">
          <div className="min-w-0">
            <p className="text-[10px] uppercase text-muted-foreground" style={{ letterSpacing: "0.2em" }}>
              Swap {tierLabel} · {region}
            </p>
            <h2 id="swap-picker-title" className="mt-1 font-serif text-lg leading-tight">
              Replace <span className="italic">{currentBottle.name}</span>
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick another {starHint} bottle you've rated in {region}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!pickInFlight.current && !promote.isPending) onClose();
            }}
            aria-label="Close"
            disabled={!!pendingId || promote.isPending}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading candidates…</p>
          ) : !candidates || candidates.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No other {starHint} bottles rated in {region} yet.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Rate another wine from this region to make it eligible.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {candidates.map((b) => {
                const isPending = pendingId === b.id;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      disabled={isPending || promote.isPending}
                      onClick={() => handlePick(b)}
                      className="w-full text-left p-3 hover:bg-accent disabled:opacity-50 disabled:cursor-wait transition"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <WineTypeBadge type={b.type} />
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {b.region}
                        </span>
                      </div>
                      <p className="mt-1 font-medium leading-tight">{b.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[b.producer, b.vintage].filter(Boolean).join(" · ")}
                      </p>
                      {isPending && (
                        <p className="mt-1 text-[11px] text-muted-foreground">Swapping…</p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
