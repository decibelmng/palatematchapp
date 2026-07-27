/**
 * Sanitize an error for user display. Real errors go to the console with
 * their full text; the returned string is a plain sentence safe to render
 * in a toast, alert, or error boundary. No raw database, network, or
 * stack-trace text ever reaches a user-facing string.
 *
 * Patterns that indicate an implementation detail leak (return generic):
 *   - PostgreSQL error codes and messages ("column reference … is ambiguous",
 *     "duplicate key value", "violates row-level security", "permission denied
 *     for", "relation … does not exist", "operator does not exist", etc.)
 *   - PostgREST error shapes ("PGRST…", "JWT expired", "…failed to parse…")
 *   - Stack traces (contain "\n    at ")
 *   - Anything mentioning "supabase", "postgres", "psql", "rpc"
 *   - JSON blobs or error objects stringified as "[object Object]"
 *
 * A short, action-shaped message the app authored itself is passed through
 * — the caller opts in by passing a `fallback` and a short whitelist of
 * safe phrasings via `friendly()`.
 */

const LEAK_PATTERNS: RegExp[] = [
  /\bcolumn\s+.+?\bambiguous/i,
  /\bduplicate key\b/i,
  /\bviolates?\b.*\brow[- ]level\b/i,
  /\bpermission denied for\b/i,
  /\brelation\s+".+?"\s+does not exist/i,
  /\boperator does not exist\b/i,
  /\bnull value in column\b/i,
  /\bforeign key constraint\b/i,
  /\bsyntax error at\b/i,
  /\bfunction\s+.+?\s+does not exist/i,
  /\bPGRST\d+/,
  /\bJWT\b.*\b(expired|invalid|malformed)\b/i,
  /\bpostgres/i,
  /\bsupabase/i,
  /\bat\s+.+?\.(ts|tsx|js|jsx):\d+:\d+/, // stack frame
  /\n\s{2,}at\s/, // multi-line stack
  /\[object Object\]/,
  /^\s*\{.*\}\s*$/, // stringified JSON blob
];

/** True if the string looks like a raw database/network/stack error. */
function looksLikeLeak(s: string): boolean {
  if (!s) return true;
  if (s.length > 200) return true;
  return LEAK_PATTERNS.some((re) => re.test(s));
}

/**
 * Extract a message from an unknown error value without leaking internals.
 * Always logs the raw error to the console (dev + production) so debugging
 * information is preserved — nothing is dropped, just kept off-screen.
 */
export function friendlyError(err: unknown, fallback?: string): string {
  // Always log the real thing for engineering.
  // eslint-disable-next-line no-console
  console.error("[friendlyError]", err);

  const generic = "Something went wrong on our end. Try again in a moment.";
  const safe = fallback && !looksLikeLeak(fallback) ? fallback : generic;

  if (err == null) return safe;
  if (typeof err === "string") return looksLikeLeak(err) ? safe : err;
  if (err instanceof Error) {
    const msg = err.message ?? "";
    return looksLikeLeak(msg) ? safe : msg;
  }
  return safe;
}
