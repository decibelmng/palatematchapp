import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light mode" : "Dark mode"}
      className="inline-flex items-center justify-center rounded-full border border-border bg-card/80 w-9 h-9 text-foreground hover:bg-accent transition-colors"
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
