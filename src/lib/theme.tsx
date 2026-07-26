import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Theme = "light" | "dark" | "service";
const STORAGE_KEY = "pm-theme";
const THEMES: Theme[] = ["light", "dark", "service"];

type Ctx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};
const ThemeContext = createContext<Ctx | null>(null);

function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "service";
}

function readInitial(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isTheme(saved)) return saved;
  } catch {}
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  // "service" is a dark theme variant for color-scheme purposes.
  document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const initial = readInitial();
    setThemeState(initial);
    apply(initial);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    async function loadFromProfile(uid: string) {
      const { data } = await supabase.from("profiles").select("theme").eq("id", uid).maybeSingle();
      const t = (data as { theme?: string | null } | null)?.theme;
      if (!cancelled && isTheme(t)) {
        setThemeState(t);
        apply(t);
        try { window.localStorage.setItem(STORAGE_KEY, t); } catch {}
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) loadFromProfile(data.session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) loadFromProfile(session.user.id);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [hydrated]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    apply(t);
    try { window.localStorage.setItem(STORAGE_KEY, t); } catch {}
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        supabase.from("profiles").update({ theme: t }).eq("id", data.session.user.id);
      }
    });
  }, []);

  const toggle = useCallback(() => {
    const idx = THEMES.indexOf(theme);
    const next = THEMES[(idx + 1) % THEMES.length];
    setTheme(next);
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return { theme: "light", setTheme: () => {}, toggle: () => {} };
  }
  return ctx;
}

/** Inline boot script — sets data-theme before paint to prevent FOUC. */
export const themeBootstrapScript = `(function(){try{var s=localStorage.getItem('${STORAGE_KEY}');var t=(s==='light'||s==='dark'||s==='service')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=(t==='light')?'light':'dark';}catch(e){document.documentElement.dataset.theme='light';}})();`;
