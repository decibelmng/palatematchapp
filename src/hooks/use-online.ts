import { useEffect, useState } from "react";

/**
 * Live navigator.onLine subscription. SSR-safe — starts optimistic ("online")
 * on the server and hydrates in the browser.
 *
 * navigator.onLine is a coarse signal (it flips only when the OS reports the
 * radio is down), but it is enough to distinguish "airplane mode / no signal"
 * from "slow signal". Slow-signal handling belongs in the stalled-batch guard.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(true);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}
