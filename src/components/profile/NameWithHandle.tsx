import { useState } from "react";
import { toast } from "sonner";
import { displayNameFor, handleForDisplay } from "@/lib/user-display";

/**
 * Display name with a hidden @handle revealed on tap/hover.
 * - Default view: display name only (no @handle inline).
 * - Tap the name: copies @handle to clipboard and briefly shows it.
 * - Hover (desktop): shows @handle in a tooltip.
 * - Accessibility: aria-label always includes the @handle for screen readers.
 * - Auto-generated handles (user_xxxx) are never rendered — a graceful
 *   placeholder is shown instead and no handle chip appears.
 */
export function NameWithHandle({
  displayName,
  username,
  className,
  size = "md",
}: {
  displayName: string | null | undefined;
  username: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const [revealed, setRevealed] = useState(false);
  const shown = displayNameFor({ display_name: displayName, username });
  const surfaceHandle = handleForDisplay(username);
  const showHandle = !!surfaceHandle && revealed;

  async function reveal() {
    if (!surfaceHandle) return;
    setRevealed(true);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(`@${surfaceHandle}`);
        toast.success(`Copied @${surfaceHandle}`);
      }
    } catch {
      /* copy is best-effort */
    }
    setTimeout(() => setRevealed(false), 2400);
  }

  const nameSize =
    size === "lg" ? "text-heading" : size === "sm" ? "text-sub" : "text-body";

  const ariaLabel = surfaceHandle
    ? `${shown} (@${surfaceHandle}) — tap to copy handle`
    : shown;

  return (
    <span className={className}>
      <button
        type="button"
        onClick={reveal}
        title={surfaceHandle ? `@${surfaceHandle}` : shown}
        aria-label={ariaLabel}
        className={`font-serif ${nameSize} leading-tight truncate text-left ${surfaceHandle ? "hover:underline decoration-primary/40 underline-offset-4" : ""}`}
      >
        {shown}
      </button>
      {showHandle && (
        <span className="ml-1.5 text-meta text-muted-foreground align-middle">
          @{surfaceHandle}
        </span>
      )}
    </span>
  );
}
