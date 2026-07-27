import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "sb-xyxanewatmrekdqowqao-auth-token";

function snapshotSbKeys() {
  if (typeof window === "undefined") return [];
  const out: Array<{ key: string; hasAccessToken: boolean }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith("sb-")) continue;
    let hasAccessToken = false;
    try {
      const v = localStorage.getItem(k);
      hasAccessToken = !!v && v.includes("access_token");
    } catch { /* ignore */ }
    out.push({ key: k, hasAccessToken });
  }
  return out;
}

export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    console.log("[auth] useSession mount", {
      origin: window.location.origin,
      href: window.location.href,
      expectedStorageKey: STORAGE_KEY,
      storageKeyPresent: !!localStorage.getItem(STORAGE_KEY),
      allSbKeys: snapshotSbKeys(),
      hash: window.location.hash?.slice(0, 40),
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      console.log("[auth] onAuthStateChange", {
        event,
        hasSession: !!s,
        userId: s?.user?.id ?? null,
        storageKeyPresent: !!localStorage.getItem(STORAGE_KEY),
        allSbKeys: snapshotSbKeys(),
      });
      setSession(s);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      console.log("[auth] getSession resolved", {
        hasSession: !!data.session,
        userId: data.session?.user?.id ?? null,
        error: error?.message ?? null,
        storageKeyPresent: !!localStorage.getItem(STORAGE_KEY),
      });
      setSession(data.session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return session; // undefined = loading, null = signed out
}
