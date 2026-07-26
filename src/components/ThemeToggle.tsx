import { Moon, Sun, Wine } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const nextLabel =
    theme === "light" ? "Switch to dark theme"
    : theme === "dark" ? "Switch to service (true black) theme"
    : "Switch to light theme";
  const Icon = theme === "light" ? Moon : theme === "dark" ? Wine : Sun;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={nextLabel}
      title={nextLabel}
      className="inline-flex items-center justify-center rounded-full border border-border bg-card w-9 h-9 text-foreground hover:bg-accent transition-colors"
    >
      <Icon size={16} />
    </button>
  );
}
