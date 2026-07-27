import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "@/integrations/supabase/client";
import { authStorageSnapshot, installAuthDebug } from "@/lib/auth-debug";
import { ThemeProvider, themeBootstrapScript } from "@/lib/theme";
import { ConfirmDialogHost } from "@/components/confirm-dialog";

const rawLandingCaptureScript = `try{var e={t:Date.now(),href:location.href,hash:location.hash,search:location.search,ref:document.referrer};var a=JSON.parse(sessionStorage.getItem('pm.rawLanding')||'[]');a.push(e);sessionStorage.setItem('pm.rawLanding',JSON.stringify(a.slice(-20)));}catch(_){}`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center cellar-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-7xl text-primary">404</h1>
        <p className="mt-3 text-muted-foreground">This bottle isn't in the cellar.</p>
        <Link to="/" className="mt-6 inline-block text-primary underline">Back home</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center cellar-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-2xl">Something spilled.</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >Try again</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Palate Match" },
      { name: "description", content: "Tap stars on bottles you've tried. Get your 5-letter taste profile and matches from the catalog." },
      { name: "theme-color", content: "#0A0808" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Palate Match" },
      { property: "og:title", content: "Palate Match" },
      { name: "twitter:title", content: "Palate Match" },
      { property: "og:description", content: "Tap stars on bottles you've tried. Get your 5-letter taste profile and matches from the catalog." },
      { name: "twitter:description", content: "Tap stars on bottles you've tried. Get your 5-letter taste profile and matches from the catalog." },

      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/b138a682-239a-4c37-b4e5-e2a066cd140e" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/b138a682-239a-4c37-b4e5-e2a066cd140e" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <head>
        <script dangerouslySetInnerHTML={{ __html: rawLandingCaptureScript }} />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <HeadContent />
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    installAuthDebug(supabase);
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      console.log("[auth] root onAuthStateChange", {
        event,
        storage: authStorageSnapshot(),
      });
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        queryClient.invalidateQueries();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <ConfirmDialogHost />
        {/* Offset = bottom-nav height (56px) + safe-area inset, so no toast
            ever overlaps the fixed nav or its safe-area padding. Pages that
            render interactive rows near the bottom of their own scroll
            container (e.g. the Account list on /palate) add their own
            bottom padding to stay clear of this zone. */}
        <Toaster
          position="bottom-center"
          closeButton
          richColors
          offset="calc(56px + env(safe-area-inset-bottom, 0px) + 8px)"
          mobileOffset="calc(56px + env(safe-area-inset-bottom, 0px) + 8px)"
        />


      </QueryClientProvider>
    </ThemeProvider>
  );
}
