import { useState } from "react";
import { Skull } from "lucide-react";
import { toast } from "sonner";
import type { BottleRow } from "@/hooks/use-palate-data";
import {
  canonScopeType,
  findBenchmarkForBottle,
  useDemoteNemesis,
  useMyCanons,
  useNemesisForScope,
  usePromoteNemesis,
  type CanonRow,
} from "@/hooks/use-canon";
import { useBottlesByIds } from "@/hooks/use-palate-data";
import { useGenericWarning } from "@/hooks/use-generic-warning";
import { confirmDialog } from "@/components/confirm-dialog";


type Props = {
  bottle: BottleRow;
  stars: number | null;
  /** Compact variant for list rows (icon only). */
  compact?: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  red: "red", white: "white", rose: "rosé", sparkling: "sparkling", dessert: "dessert",
};

export function NemesisAction({ bottle, stars, compact = false }: Props) {
  const { data: canons } = useMyCanons();
  const conflicting = useNemesisForScope(bottle);
  const promote = usePromoteNemesis();
  const demote = useDemoteNemesis();
  const genericWarning = useGenericWarning();
  const [dialog, setDialog] = useState<"idle" | "confirm" | "replace">("idle");

  const myNemesisForThis = findBenchmarkForBottle(canons, bottle.id, "nemesis");
  const isNemesis = !!myNemesisForThis;
  const region = (bottle.region ?? "").trim();
  const wineType = canonScopeType(bottle);
  const typeLabel = TYPE_LABEL[wineType] ?? wineType;

  // Show only if either currently a Nemesis OR the bottle has a 1–2★ rating.
  // Explicitly blocked above 2★.
  if (!isNemesis) {
    if (stars == null) return null;
    if (stars > 2) return null;
    if (!region) return null;
  }

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (isNemesis) {
      if (confirm(`Remove Nemesis status from ${bottle.name}? It'll revert to its ${stars ?? 1}★ rating.`)) {
        demote.mutate(myNemesisForThis!.id);
      }
      return;
    }
    setDialog(conflicting ? "replace" : "confirm");
  }

  const label = isNemesis ? "Nemesis (tap to remove)" : "Mark as my Nemesis";
  const btnClasses = compact
    ? "inline-flex items-center justify-center rounded-full p-1.5 transition"
    : "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-semibold transition";
  const style = isNemesis
    ? {
        color: "var(--destructive)",
        borderColor: "color-mix(in oklab, var(--destructive) 55%, transparent)",
        background: "color-mix(in oklab, var(--destructive) 14%, transparent)",
      }
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
        <Skull size={compact ? 14 : 13} strokeWidth={2.2} />
        {!compact && (isNemesis ? "Nemesis" : "Mark Nemesis")}
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
              toast.error(msg || "Couldn't mark Nemesis");
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
        <div className="flex items-center gap-2 text-destructive">
          <Skull size={20} strokeWidth={2.2} />
          <h3 className="font-serif text-lg text-foreground">
            {existing ? "Replace your Nemesis?" : "Mark your dealbreaker"}
          </h3>
        </div>

        {existing ? (
          <div className="mt-3 space-y-3 text-sm">
            <p className="text-muted-foreground">
              You already have a Nemesis {region} {typeLabel}:
            </p>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <p className="font-medium text-foreground text-sm">
                {existingBottle?.name ?? "Current Nemesis"}
              </p>
              {existingBottle && (
                <p className="text-xs text-muted-foreground">
                  {[existingBottle.producer, existingBottle.vintage].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Replace it with <span className="text-foreground font-medium">{bottle.name}</span>?
              The previous Nemesis reverts to its star rating.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            This becomes your definitive dealbreaker for{" "}
            <span className="text-foreground font-medium">{region} {typeLabel}</span>.
            The engine will steer you away from anything in its style.
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
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive text-destructive-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-60"
          >
            <Skull size={14} strokeWidth={2.2} />
            {existing ? "Replace" : "Mark it Nemesis"}
          </button>
        </div>
      </div>
    </div>
  );
}
