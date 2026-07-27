import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AUTH_STORAGE_KEY, authStorageSnapshot, getAuthGateMountCount, installAuthDebug } from "@/lib/auth-debug";

export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    installAuthDebug(supabase);
    console.log("[auth] useSession mount", {
      origin: window.location.origin,
      href: window.location.href,
      expectedStorageKey: AUTH_STORAGE_KEY,
      authGateMounts: getAuthGateMountCount(),
      storage: authStorageSnapshot(),
      hash: window.location.hash?.slice(0, 40),
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      console.log("[auth] onAuthStateChange", {
        event,
        hasSession: !!s,
        userId: s?.user?.id ?? null,
        authGateMounts: getAuthGateMountCount(),
        storage: authStorageSnapshot(),
      });
      setSession(s);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      console.log("[auth] getSession resolved", {
        hasSession: !!data.session,
        userId: data.session?.user?.id ?? null,
        error: error?.message ?? null,
        storage: authStorageSnapshot(),
      });
      setSession(data.session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return session; // undefined = loading, null = signed out
}
