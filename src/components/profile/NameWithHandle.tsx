import { useState } from "react";
import { toast } from "sonner";

/**
 * Display name with a hidden @handle revealed on tap/hover.
 * - Default view: display name only (no @handle inline).
 * - Tap the name: copies @handle to clipboard and briefly shows it.
 * - Hover (desktop): shows @handle in a tooltip.
 * - Accessibility: aria-label always includes the @handle for screen readers.
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
  const shown = displayName?.trim() || username;
  const showHandle = revealed || !displayName?.trim();

  async function reveal() {
    setRevealed(true);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(`@${username}`);
        toast.success(`Copied @${username}`);
      }
    } catch {
      /* copy is best-effort */
    }
    setTimeout(() => setRevealed(false), 2400);
  }

  const nameSize =
    size === "lg" ? "text-[22px]" : size === "sm" ? "text-[14px]" : "text-[18px]";

  return (
    <span className={className}>
      <button
        type="button"
        onClick={reveal}
        title={`@${username}`}
        aria-label={`${shown} (@${username}) — tap to copy handle`}
        className={`font-serif ${nameSize} leading-tight truncate text-left hover:underline decoration-primary/40 underline-offset-4`}
      >
        {shown}
      </button>
      {showHandle && (
        <span className="ml-1.5 text-[11px] text-muted-foreground align-middle">
          @{username}
        </span>
      )}
    </span>
  );
}
