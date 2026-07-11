import { useEffect, useState } from "react";

export type MatchesLayout = "lanes" | "flat";
const KEY = "matches:layout";
const DEFAULT: MatchesLayout = "lanes";

/** SSR-safe localStorage-backed layout preference for /matches. */
export function useMatchesLayout(): [MatchesLayout, (v: MatchesLayout) => void] {
  const [value, setValue] = useState<MatchesLayout>(DEFAULT);

  // Read after mount to avoid SSR/hydration mismatch.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw === "lanes" || raw === "flat") setValue(raw);
    } catch {
      /* ignore */
    }
  }, []);

  const set = (v: MatchesLayout) => {
    setValue(v);
    try { window.localStorage.setItem(KEY, v); } catch { /* ignore */ }
  };

  return [value, set];
}
