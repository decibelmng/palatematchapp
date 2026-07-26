import { Link } from "@tanstack/react-router";
import { ScanLine, Camera, X } from "lucide-react";
import { useEffect } from "react";

export function ScanChooserSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-label="Choose scan mode"
        className="relative w-full max-w-xl rounded-t-2xl border-t border-border bg-card p-5 pb-8 shadow-2xl"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-lg">What are you scanning?</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Link
            to="/scan/list"
            search={{ capture: "1" } as any}
            onClick={onClose}
            className="rounded-xl border-2 border-primary/60 bg-gradient-to-br from-primary/15 via-card to-card p-4 hover:border-primary transition text-left"
          >
            <div className="h-11 w-11 rounded-xl bg-primary/20 text-primary flex items-center justify-center mb-3">
              <ScanLine size={22} strokeWidth={1.8} />
            </div>
            <div className="font-serif text-base leading-tight">Wine list</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Rank every bottle on a menu.
            </p>
          </Link>

          <Link
            to="/scan/bottle"
            search={{ capture: "1" } as any}
            onClick={onClose}
            className="rounded-xl border-2 border-border bg-card p-4 hover:border-primary/60 transition text-left"
          >
            <div className="h-11 w-11 rounded-xl bg-accent/40 text-foreground flex items-center justify-center mb-3">
              <Camera size={22} strokeWidth={1.8} />
            </div>
            <div className="font-serif text-base leading-tight">Bottle label</div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Identify one bottle and rate it.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
