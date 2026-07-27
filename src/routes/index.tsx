import { createFileRoute, redirect } from "@tanstack/react-router";

// The old home hero is retired. There is one scan destination — /scan/list —
// and one scan launcher, the center button in the nav. `/` used to render a
// duplicate hero and cold-open into /rate; both were IA noise.
//
// ⚠️ AUTH CALLBACKS MUST NEVER LAND HERE.
// A thrown TanStack `redirect` discards `window.location.hash` and clears
// the query string, which means any OAuth or magic-link tokens returning to
// `/` are destroyed before the Supabase client can consume them. Point every
// `redirect_uri` / `emailRedirectTo` at `/auth/callback` instead. The safety
// net below catches the case where someone forgets.
export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: () => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash ?? "";
      const search = window.location.search ?? "";
      const looksLikeAuthReturn =
        /[#&?](access_token|refresh_token|provider_token|id_token)=/.test(hash) ||
        /[?&](code|token_hash|error|error_description)=/.test(search);
      if (looksLikeAuthReturn) {
        // Preserve hash + search intact — the Supabase client needs them.
        window.location.replace(`/auth/callback${search}${hash}`);
        // Halt the router; the browser is navigating away.
        throw new Error("redirecting auth return to /auth/callback");
      }
    }
    throw redirect({ to: "/scan/list" });
  },
});
