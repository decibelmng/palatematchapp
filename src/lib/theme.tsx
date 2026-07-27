import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Two independent axes:
 *   - `base`: user's light/dark preference. Persists across sessions.
 *   - `service`: contextual overlay for dark restaurants. True-black + max contrast.
 *     Persists separately so toggling it OFF restores the user's base preference,
 *     not a default.
 *
 * The applied data-theme is "service" when the overlay is on, otherwise base.
 */
export type BaseTheme = "light" | "dark";
export type AppliedTheme = BaseTheme | "service";

const BASE_KEY = "pm-theme";           // kept as "pm-theme" for back-compat
const SERVICE_KEY = "pm-service-mode"; // "1" | "0"

type Ctx = {
  base: BaseTheme;
  service: boolean;
  theme: AppliedTheme;                     // the theme actually applied
  setBase: (t: BaseTheme) => void;
  toggleBase: () => void;
  setService: (on: boolean) => void;
  toggleService: () => void;
};
const ThemeContext = createContext<Ctx | null>(null);

function isBase(v: unknown): v is BaseTheme {
  return v === "light" || v === "dark";
}

function readInitialBase(): BaseTheme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(BASE_KEY);
    if (isBase(saved)) return saved;
    // Back-compat: an older build persisted "service" here. Drop it — service
    // is now a separate axis; treat that user as having no base preference.
  } catch {}
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
}

function readInitialService(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SERVICE_KEY) === "1";
  } catch { return false; }
}

function apply(base: BaseTheme, service: boolean) {
  if (typeof document === "undefined") return;
  const applied: AppliedTheme = service ? "service" : base;
  document.documentElement.dataset.theme = applied;
  document.documentElement.style.colorScheme = applied === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [base, setBaseState] = useState<BaseTheme>("light");
  const [service, setServiceState] = useState<boolean>(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const b = readInitialBase();
    const s = readInitialService();
    setBaseState(b);
    setServiceState(s);
    apply(b, s);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;

    async function loadFromProfile(uid: string) {
      const { data } = await supabase.from("profiles").select("theme").eq("id", uid).maybeSingle();
      const t = (data as { theme?: string | null } | null)?.theme;
      // Only accept a base value from the profile. Service is device-local.
      if (!cancelled && isBase(t)) {
        setBaseState(t);
        apply(t, service);
        try { window.localStorage.setItem(BASE_KEY, t); } catch {}
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) loadFromProfile(data.session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) loadFromProfile(session.user.id);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, [hydrated, service]);

  const setBase = useCallback((t: BaseTheme) => {
    setBaseState(t);
    apply(t, service);
    try { window.localStorage.setItem(BASE_KEY, t); } catch {}
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        supabase.from("profiles").update({ theme: t }).eq("id", data.session.user.id);
      }
    });
  }, [service]);

  const toggleBase = useCallback(() => {
    setBase(base === "light" ? "dark" : "light");
  }, [base, setBase]);

  const setService = useCallback((on: boolean) => {
    setServiceState(on);
    apply(base, on);
    try { window.localStorage.setItem(SERVICE_KEY, on ? "1" : "0"); } catch {}
  }, [base]);

  const toggleService = useCallback(() => setService(!service), [service, setService]);

  const applied: AppliedTheme = service ? "service" : base;

  return (
    <ThemeContext.Provider value={{ base, service, theme: applied, setBase, toggleBase, setService, toggleService }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      base: "light", service: false, theme: "light",
      setBase: () => {}, toggleBase: () => {}, setService: () => {}, toggleService: () => {},
    };
  }
  return ctx;
}

/** Inline boot script — sets data-theme before paint to prevent FOUC. */
export const themeBootstrapScript = `(function(){try{var b=localStorage.getItem('${BASE_KEY}');var s=localStorage.getItem('${SERVICE_KEY}')==='1';var base=(b==='light'||b==='dark')?b:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var t=s?'service':base;document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=(t==='light')?'light':'dark';}catch(e){document.documentElement.dataset.theme='light';}})();`;
