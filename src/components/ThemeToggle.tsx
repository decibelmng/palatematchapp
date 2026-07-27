import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

/**
 * Two-state light ↔ dark toggle. Service mode is a separate overlay switch
 * (see ServiceModeSwitch) — not part of this cycle.
 */
export function ThemeToggle() {
  const { base, toggleBase } = useTheme();
  const label = base === "light" ? "Switch to dark theme" : "Switch to light theme";
  const Icon = base === "light" ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={toggleBase}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center rounded-full border border-border bg-card w-9 h-9 text-foreground hover:bg-accent transition-colors"
    >
      <Icon size={16} />
    </button>
  );
}
