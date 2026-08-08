import { friendlyError } from "@/lib/error-message";

/**
 * THE single scan-failure surface for the wine-list flow.
 *
 * Before this component there were three inline renderings plus a toast, all
 * live at once with different advice ("Couldn't read anything from those
 * photos…", "Couldn't read that list.", the raw mutation message, and a
 * "Scan failed" toast). One state at a time: this renders one message and one
 * action, and the caller never renders it alongside a success state.
 */
export type ScanFailure =
  | { kind: "threw"; error: unknown }
  | { kind: "unreadable" };

export function ScanStateMessage({
  failure, onRetry,
}: {
  failure: ScanFailure;
  onRetry: () => void;
}) {
  const headline =
    failure.kind === "threw"
      ? friendlyError(failure.error, "That scan didn't finish.")
      : "Couldn't read that list.";

  return (
    <div role="alert" className="mt-6 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sub text-foreground font-medium">{headline}</p>
      <p className="mt-1 text-meta text-muted-foreground">
        Try again with more light, holding the phone closer and straight on.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 min-h-11 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sub font-medium"
      >
        Start a new scan
      </button>
    </div>
  );
}
