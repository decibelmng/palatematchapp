import { useState } from "react";
import { Crown } from "lucide-react";
import { toast } from "sonner";
import type { BottleRow } from "@/hooks/use-palate-data";
import {
  canonScopeType,
  useCanonForScope,
  useDemoteCanon,
  findBenchmarkForBottle,
  useMyCanons,
  usePromoteCanon,
  type CanonRow,
} from "@/hooks/use-canon";
import { useBottlesByIds } from "@/hooks/use-palate-data";
import { useGenericWarning } from "@/hooks/use-generic-warning";

type Props = {
  bottle: BottleRow;
  stars: number | null;
  /** Compact variant for list rows (icon only). */
  compact?: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  red: "red", white: "white", rose: "rosé", sparkling: "sparkling", dessert: "dessert",
};

export function CanonAction({ bottle, stars, compact = false }: Props) {
  const { data: canons } = useMyCanons();
  const conflicting = useCanonForScope(bottle);
  const promote = usePromoteCanon();
  const demote = useDemoteCanon();
  const genericWarning = useGenericWarning();
  const [dialog, setDialog] = useState<"idle" | "confirm" | "replace">("idle");

  const myCanonForThis = findBenchmarkForBottle(canons, bottle.id, "canon");
  const isCanon = !!myCanonForThis;
  const region = (bottle.region ?? "").trim();
  const wineType = canonScopeType(bottle);
  const typeLabel = TYPE_LABEL[wineType] ?? wineType;

  // Show only when the bottle already has a 5★ rating (or is currently Canon).
  if (!isCanon && (stars ?? 0) < 5) return null;
  if (!region && !isCanon) return null;

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (isCanon) {
      if (confirm(`Remove Canon status from ${bottle.name}? It'll revert to its ${stars ?? 5}★ rating.`)) {
        demote.mutate(myCanonForThis!.id);
      }
      return;
    }
    setDialog(conflicting ? "replace" : "confirm");
  }

  const label = isCanon ? "Canon (tap to remove)" : "Make this my Canon";
  const btnClasses = compact
    ? "inline-flex items-center justify-center rounded-full p-1.5 transition"
    : "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition";
  const gold = "#b8860b";
  const style = isCanon
    ? { color: gold, borderColor: `color-mix(in oklab, ${gold} 55%, transparent)`, background: `color-mix(in oklab, ${gold} 14%, transparent)` }
    : { color: "var(--muted-foreground)", borderColor: "var(--border)", background: "transparent" };

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className={btnClasses}
        style={style}
      >
        <Crown size={compact ? 14 : 13} strokeWidth={2.2} fill={isCanon ? "currentColor" : "none"} />
        {!compact && (isCanon ? "Canon" : "Make Canon")}
      </button>

      {dialog !== "idle" && (
        <ConfirmDialog
          bottle={bottle}
          region={region}
          typeLabel={typeLabel}
          existing={dialog === "replace" ? conflicting : null}
          onCancel={() => setDialog("idle")}
          onConfirm={async () => {
            try {
              const ok = await genericWarning.confirmIfGeneric(bottle);
              if (!ok) { setDialog("idle"); return; }
              await promote.mutateAsync({ bottle, replace: dialog === "replace" ? conflicting : null });
              setDialog("idle");
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              toast.error(msg || "Couldn't crown Canon");
              setDialog("idle");
            }
          }}
          pending={promote.isPending}
        />
      )}
    </>
  );
}

function ConfirmDialog({
  bottle, region, typeLabel, existing, onCancel, onConfirm, pending,
}: {
  bottle: BottleRow;
  region: string;
  typeLabel: string;
  existing: CanonRow | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  // If replacing, look up the existing bottle for a friendlier label.
  const { data: existingBottles } = useBottlesByIds(existing ? [existing.bottle_id] : []);
  const existingBottle = existingBottles?.[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-card border border-border p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-amber-500">
          <Crown size={20} strokeWidth={2.2} fill="currentColor" />
          <h3 className="font-serif text-lg text-foreground">
            {existing ? "Replace your Canon?" : "Crown your benchmark"}
          </h3>
        </div>

        {existing ? (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-muted-foreground">
              You already have a Canon {region} {typeLabel}:
            </p>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="font-medium text-foreground text-sm">
                {existingBottle?.name ?? "Current Canon"}
              </p>
              {existingBottle && (
                <p className="text-xs text-muted-foreground">
                  {[existingBottle.producer, existingBottle.vintage].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Replace it with <span className="text-foreground font-medium">{bottle.name}</span>?
              The previous Canon reverts to its star rating.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            This becomes your definitive <span className="text-foreground font-medium">{region} {typeLabel}</span>.
            The engine treats it as your perfect match for this region — you can only have one.
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            {existing ? "Keep current" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 text-white px-4 py-2 text-sm font-semibold hover:bg-amber-600 disabled:opacity-60"
          >
            <Crown size={14} strokeWidth={2.2} fill="currentColor" />
            {existing ? "Replace" : "Make it Canon"}
          </button>
        </div>
      </div>
    </div>
  );
}
