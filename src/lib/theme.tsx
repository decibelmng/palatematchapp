import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Theme = "light" | "dark";
const STORAGE_KEY = "pm-theme";

type Ctx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};
const ThemeContext = createContext<Ctx | null>(null);

function readInitial(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
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

  // After sign-in, prefer the saved profile theme (cross-device sync).
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    async function loadFromProfile(uid: string) {
      const { data } = await supabase.from("profiles").select("theme").eq("id", uid).maybeSingle();
      const t = (data as { theme?: string | null } | null)?.theme;
      if (!cancelled && (t === "light" || t === "dark")) {
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
    setTheme(theme === "dark" ? "light" : "dark");
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
export const themeBootstrapScript = `(function(){try{var s=localStorage.getItem('${STORAGE_KEY}');var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;
