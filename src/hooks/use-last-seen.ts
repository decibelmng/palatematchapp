import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { pingLastSeen } from "@/lib/last-seen.functions";

const KEY = "pm.lastSeenPingAt";
const THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

/** Fires at most once per 5 minutes per browser session for the signed-in user. */
export function useLastSeenPing(userId: string | null | undefined) {
  const ping = useServerFn(pingLastSeen);
  useEffect(() => {
    if (!userId) return;
    try {
      const last = Number(localStorage.getItem(KEY) ?? 0);
      if (Date.now() - last < THROTTLE_MS) return;
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      // localStorage unavailable — still ping once this mount.
    }
    ping().catch(() => { /* non-critical */ });
  }, [userId, ping]);
}
