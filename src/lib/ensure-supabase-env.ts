// Guarantees the public Supabase URL/publishable key are present in
// process.env for the SSR worker, even when deploy-time env injection misses
// them. Runs at server-module top-level so it beats every downstream import
// (auth-middleware, server functions, SSR route loaders).
try {
  if (typeof process !== "undefined" && process.env) {
    process.env.SUPABASE_URL ||= "https://xyxanewatmrekdqowqao.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEY ||=
      "sb_publishable_uBdGKhTkSyYWE3SJQXa-PA_wAxapy9_";
  }
} catch {
  // process.env is read-only in some runtimes — ignore; the middleware
  // fallback in src/start.ts still applies at function-call time.
}
export {};
