import { MoonStar } from "lucide-react";
import { useTheme } from "@/lib/theme";

/**
 * Independent overlay for dark restaurants. True-black surfaces + max contrast.
 * Toggling OFF restores the user's base light/dark preference.
 *
 * Two variants:
 *   - "chip"   — labeled pill for placement on scan / scan-result screens
 *   - "icon"   — compact icon-only button for tight toolbars
 */
export function ServiceModeSwitch({
  variant = "chip",
  className = "",
}: {
  variant?: "chip" | "icon";
  className?: string;
}) {
  const { service, toggleService } = useTheme();
  const label = service ? "Turn off dark restaurant mode" : "Turn on dark restaurant mode";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggleService}
        aria-pressed={service}
        aria-label={label}
        title={label}
        className={`inline-flex items-center justify-center rounded-full border w-9 h-9 transition-colors ${
          service
            ? "border-primary bg-primary/15 text-primary"
            : "border-border bg-card text-foreground hover:bg-accent"
        } ${className}`}
      >
        <MoonStar size={16} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleService}
      aria-pressed={service}
      aria-label={label}
      className={`inline-flex items-center gap-2 rounded-full border px-3 h-9 text-meta font-medium transition-colors ${
        service
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-card text-foreground hover:bg-accent"
      } ${className}`}
    >
      <MoonStar size={14} />
      <span>Dark restaurant mode{service ? " · on" : ""}</span>
    </button>
  );
}
