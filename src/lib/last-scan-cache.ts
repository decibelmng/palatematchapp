// Local cache for the most recent scan so airplane-mode / basement openings
// still show a fully readable, rankable list. One entry, versioned. Data
// stays on-device — never sent anywhere.

const KEY = "pm.last-scan.v1";

export type LastScanCache = {
  v: 1;
  scan_id: string;
  cached_at: string;
  // Kept intentionally loose: whatever /scan/list already renders from the
  // server payload. We round-trip it through JSON, so it must serialize.
  payload: unknown;
};

export function readLastScan(): LastScanCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastScanCache;
    if (!parsed || parsed.v !== 1 || !parsed.scan_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeLastScan(scan_id: string, payload: unknown): void {
  if (typeof window === "undefined") return;
  try {
    const entry: LastScanCache = {
      v: 1,
      scan_id,
      cached_at: new Date().toISOString(),
      payload,
    };
    window.localStorage.setItem(KEY, JSON.stringify(entry));
  } catch {
    // Storage full / disabled / private mode — non-fatal.
  }
}

export function clearLastScan(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(KEY); } catch { /* noop */ }
}
