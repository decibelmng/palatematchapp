// Pending-invite plumbing: capture the invite token when a signed-out visitor
// lands on /i/:token, then auto-redeem after they sign in.

const KEY = "pm-pending-invite";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type Stored = { token: string; at: number };

export function stashPendingInvite(token: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, at: Date.now() } satisfies Stored));
  } catch { /* noop */ }
}

export function readPendingInvite(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (!s?.token || typeof s.at !== "number") return null;
    if (Date.now() - s.at > MAX_AGE_MS) { localStorage.removeItem(KEY); return null; }
    return s.token;
  } catch { return null; }
}

export function clearPendingInvite() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(KEY); } catch { /* noop */ }
}
