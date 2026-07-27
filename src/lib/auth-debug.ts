import type { Session, SupabaseClient } from "@supabase/supabase-js";

export const AUTH_STORAGE_KEY = "sb-xyxanewatmrekdqowqao-auth-token";
export const AUTH_TRACE_KEY = "pm.authTrace";
const MAX_TRACE = 200;

const INSTALL_FLAG = "__pmAuthDebugInstalled";

type AuthDebugWindow = Window & {
  [INSTALL_FLAG]?: boolean;
  __pmAuthGateMounts?: number;
};

/** Persist a trace event to sessionStorage so it survives OAuth redirects and
 *  can be rendered on-page even if devtools/console is unavailable. */
export function authTrace(event: string, data: Record<string, unknown> = {}) {
  try { console.log(`[auth] ${event}`, data); } catch { /* ignore */ }
  if (typeof window === "undefined") return;
  try {
    const raw = sessionStorage.getItem(AUTH_TRACE_KEY);
    const arr: Array<{ t: number; origin: string; event: string; data: unknown }> = raw ? JSON.parse(raw) : [];
    arr.push({ t: Date.now(), origin: window.location.origin, event, data });
    while (arr.length > MAX_TRACE) arr.shift();
    sessionStorage.setItem(AUTH_TRACE_KEY, JSON.stringify(arr));
  } catch { /* ignore */ }
}

export function readAuthTrace(): Array<{ t: number; origin: string; event: string; data: unknown }> {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(AUTH_TRACE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function clearAuthTrace() {
  if (typeof window !== "undefined") sessionStorage.removeItem(AUTH_TRACE_KEY);
}

export function snapshotSbKeys() {
  if (typeof window === "undefined") return [];
  const out: Array<{ key: string; hasAccessToken: boolean; bytes: number }> = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("sb-")) continue;
    let hasAccessToken = false;
    let bytes = 0;
    try {
      const value = localStorage.getItem(key) ?? "";
      hasAccessToken = value.includes("access_token");
      bytes = value.length;
    } catch {
      // ignore storage read failures; this is diagnostic-only.
    }
    out.push({ key, hasAccessToken, bytes });
  }
  return out;
}

export function authStorageSnapshot() {
  if (typeof window === "undefined") {
    return {
      origin: "ssr",
      expectedStorageKey: AUTH_STORAGE_KEY,
      storageKeyPresent: false,
      allSbKeys: [] as ReturnType<typeof snapshotSbKeys>,
    };
  }
  return {
    origin: window.location.origin,
    expectedStorageKey: AUTH_STORAGE_KEY,
    storageKeyPresent: !!localStorage.getItem(AUTH_STORAGE_KEY),
    allSbKeys: snapshotSbKeys(),
  };
}

function oauthReturnState() {
  if (typeof window === "undefined") return { detected: false };
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const queryKeys = ["code", "state", "error", "error_description", "provider", "token_hash"];
  const hashKeys = ["access_token", "refresh_token", "expires_at", "token_type", "provider_token"];
  const presentQueryKeys = queryKeys.filter((key) => url.searchParams.has(key));
  const presentHashKeys = hashKeys.filter((key) => hashParams.has(key));
  return {
    detected: presentQueryKeys.length > 0 || presentHashKeys.length > 0,
    href: window.location.href,
    queryKeys: presentQueryKeys,
    hashKeys: presentHashKeys,
  };
}

function sessionSummary(session: Session | null | undefined) {
  return {
    hasSession: !!session,
    userId: session?.user?.id ?? null,
    expiresAt: session?.expires_at ?? null,
  };
}

export function registerAuthGateMount() {
  if (typeof window === "undefined") return 0;
  const w = window as AuthDebugWindow;
  w.__pmAuthGateMounts = (w.__pmAuthGateMounts ?? 0) + 1;
  return w.__pmAuthGateMounts;
}

export function getAuthGateMountCount() {
  if (typeof window === "undefined") return 0;
  return (window as AuthDebugWindow).__pmAuthGateMounts ?? 0;
}

export function installAuthDebug(supabase: SupabaseClient) {
  if (typeof window === "undefined") return;
  const w = window as AuthDebugWindow;
  if (w[INSTALL_FLAG]) return;
  w[INSTALL_FLAG] = true;

  console.log("[auth] debug install", {
    ...authStorageSnapshot(),
    oauthReturn: oauthReturnState(),
  });

  const auth = supabase.auth;
  const originalSetSession = auth.setSession.bind(auth);
  auth.setSession = (async (sessionLike: Parameters<typeof auth.setSession>[0]) => {
    console.log("[auth] setSession called", {
      origin: window.location.origin,
      hasAccessToken: !!sessionLike?.access_token,
      hasRefreshToken: !!sessionLike?.refresh_token,
      before: authStorageSnapshot(),
    });
    const result = await originalSetSession(sessionLike);
    console.log("[auth] setSession resolved", {
      error: result.error?.message ?? null,
      ...sessionSummary(result.data.session),
      after: authStorageSnapshot(),
    });
    return result;
  }) as typeof auth.setSession;

  const originalGetSession = auth.getSession.bind(auth);
  auth.getSession = (async (...args: Parameters<typeof auth.getSession>) => {
    console.log("[auth] getSession called", {
      origin: window.location.origin,
      storage: authStorageSnapshot(),
      oauthReturn: oauthReturnState(),
    });
    const result = await originalGetSession(...args);
    console.log("[auth] getSession returned", {
      error: result.error?.message ?? null,
      ...sessionSummary(result.data.session),
      storage: authStorageSnapshot(),
    });
    return result;
  }) as typeof auth.getSession;

  window.addEventListener("message", (event) => {
    if (!String(event.origin).includes("lovable") && event.origin !== window.location.origin) return;
    const data = event.data && typeof event.data === "object" ? event.data : null;
    console.log("[auth] window message", {
      origin: event.origin,
      dataKeys: data ? Object.keys(data).slice(0, 12) : [],
      storage: authStorageSnapshot(),
    });
  });
}