import { Link, useNavigate } from "@tanstack/react-router";
import { ScanLine, Camera, X, Users } from "lucide-react";
import { useEffect, useRef } from "react";
import { setPendingCapture, type CaptureKind } from "@/lib/scan-handoff";

export function ScanChooserSheet({
  open,
  onClose,
  sommVerified = false,
}: {
  open: boolean;
  onClose: () => void;
  sommVerified?: boolean;
}) {
  const navigate = useNavigate();
  const listCamera = useRef<HTMLInputElement>(null);
  const listLibrary = useRef<HTMLInputElement>(null);
  const bottleCamera = useRef<HTMLInputElement>(null);
  const bottleLibrary = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  /**
   * Choosing from the chooser IS the intent, so the camera opens here — two
   * taps from the SCAN button, not three.
   *
   * iOS Safari only honours a programmatic `input.click()` while the user
   * gesture is still live, and the gesture is lost across any `await`. So this
   * handler does exactly one thing, synchronously: click the input. No session
   * check, no navigation, no analytics, no state update before the click. The
   * navigation happens later, in the input's change handler, which is itself a
   * fresh user-initiated event.
   *
   * The library path is the same rule: one ref lookup, one synchronous click.
   * The only difference between the two inputs is the `capture` attribute.
   */
  const openPicker = (source: "camera" | "library", kind: CaptureKind) => {
    const el =
      kind === "list"
        ? source === "camera" ? listCamera.current : listLibrary.current
        : source === "camera" ? bottleCamera.current : bottleLibrary.current;
    el?.click();
  };

  const onCaptured = (kind: CaptureKind, files: FileList | null, el: HTMLInputElement) => {
    const list = files ? Array.from(files) : [];
    el.value = "";
    if (list.length === 0) return;
    setPendingCapture(kind, list);
    onClose();
    navigate({ to: kind === "list" ? "/scan/list" : "/scan/bottle" });
  };

  const linkClass =
    "block w-full min-h-11 px-4 py-3 text-left text-meta text-muted-foreground underline underline-offset-2 hover:text-foreground";


  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />

      {/* Hidden capture inputs live in the sheet so the click is synchronous
          with the tap on the card above them. */}
      <input
        ref={listInput} type="file" accept="image/*" capture="environment" multiple className="hidden"
        onChange={(e) => onCaptured("list", e.target.files, e.currentTarget)}
      />
      <input
        ref={bottleInput} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => onCaptured("bottle", e.target.files, e.currentTarget)}
      />

      <div
        role="dialog"
        aria-label="Choose scan mode"
        className="relative w-full max-w-xl rounded-t-2xl border-t border-border bg-card p-5 pb-8 shadow-2xl"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 2rem)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-lg">{sommVerified ? "What would you like to do?" : "What are you scanning?"}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => openCamera("list")}
            className="rounded-xl border-2 border-primary/60 bg-gradient-to-br from-primary/15 via-card to-card p-4 hover:border-primary transition text-left"
          >
            <div className="h-11 w-11 rounded-xl bg-primary/20 text-primary flex items-center justify-center mb-3">
              <ScanLine size={22} strokeWidth={1.8} />
            </div>
            <div className="font-serif text-base leading-tight">Wine list</div>
            <p className="mt-1 text-meta text-muted-foreground">
              Rank every bottle on a menu.
            </p>
          </button>

          <button
            type="button"
            onClick={() => openCamera("bottle")}
            className="rounded-xl border-2 border-border bg-card p-4 hover:border-primary/60 transition text-left"
          >
            <div className="h-11 w-11 rounded-xl bg-accent/40 text-foreground flex items-center justify-center mb-3">
              <Camera size={22} strokeWidth={1.8} />
            </div>
            <div className="font-serif text-base leading-tight">Bottle label</div>
            <p className="mt-1 text-meta text-muted-foreground">
              Identify one bottle and rate it.
            </p>
          </button>
        </div>

        {sommVerified && (
          <Link
            to="/somm/table"
            onClick={onClose}
            className="mt-3 flex items-center gap-3 rounded-xl border-2 border-border bg-card p-4 hover:border-primary/60 transition text-left"
          >
            <div className="h-11 w-11 rounded-xl bg-accent/40 text-foreground flex items-center justify-center shrink-0">
              <Users size={22} strokeWidth={1.8} />
            </div>
            <div>
              <div className="font-serif text-base leading-tight">Call the table</div>
              <p className="mt-1 text-meta text-muted-foreground">
                Pick the bottle for a table of guests.
              </p>
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}
