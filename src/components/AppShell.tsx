import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScanLine, Pencil, Star, Crown, Moon, Sun, Users, Bookmark } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMyProfile } from "@/hooks/use-friends";
import { markScanUnlockSeen } from "@/lib/friends.functions";
import { useTheme } from "@/lib/theme";
import { useRatingsCount, UNLOCK_THRESHOLD } from "@/components/UnlockMeter";
import { useFeedActivity, hasFreshActivity } from "@/hooks/use-feed";

const TABS = [
  { to: "/", label: "Scan", Icon: ScanLine },
  { to: "/feed", label: "Feed", Icon: Users },
  { to: "/rate", label: "Rate", Icon: Pencil },
  { to: "/palate", label: "Palate", Icon: Star },
] as const;

type TabTo = (typeof TABS)[number]["to"];

function initialsFor(name: string | null | undefined): string {
  if (!name) return "•";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isActive(pathname: string, to: TabTo): boolean {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(to + "/");
}

function A2HSHint() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem("pm-a2hs-dismissed") === "1") return;
      const ua = window.navigator.userAgent || "";
      const isIOS = /iPhone|iPad|iPod/.test(ua) && !("MSStream" in window);
      const nav = window.navigator as Navigator & { standalone?: boolean };
      const standalone = nav.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
      if (isIOS && !standalone) setVisible(true);
    } catch { /* noop */ }
  }, []);
  if (!visible) return null;
  return (
    <div
      role="dialog"
      aria-label="Install Palate Match"
      className="fixed inset-x-3 z-40 rounded-xl border border-border bg-card px-4 py-3 shadow-lg text-sm"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)" }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <div className="font-medium text-foreground">Add Palate Match to your Home Screen</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Tap Share <span aria-hidden>⎋</span> then "Add to Home Screen" for a full-screen app.
          </div>
        </div>
        <button
          onClick={() => { try { localStorage.setItem("pm-a2hs-dismissed", "1"); } catch { /* noop */ } setVisible(false); }}
          aria-label="Dismiss install hint"
          className="min-h-11 min-w-11 -m-2 rounded-md text-muted-foreground hover:text-foreground"
        >✕</button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { data: profile } = useMyProfile();
  const { theme, toggle } = useTheme();
  const initials = initialsFor(
    (profile as { display_name?: string | null; username?: string | null } | undefined)?.display_name
      ?? (profile as { username?: string | null } | undefined)?.username
      ?? null,
  );

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // Unlock celebration: fire exactly once per user, ever. Gated on a
  // server-persisted flag (profiles.scan_unlock_seen) so it survives reloads,
  // new devices, and cache resets. Local refs only guard against double-fire
  // within a single render loop.
  const ratingsCount = useRatingsCount();
  const celebratedRef = useRef(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const markSeen = useServerFn(markScanUnlockSeen);
  const scanUnlockSeen = (profile as { scan_unlock_seen?: boolean } | undefined)?.scan_unlock_seen;
  useEffect(() => {
    if (!profile) return;                       // wait for profile to hydrate
    if (celebratedRef.current) return;
    if (scanUnlockSeen) return;                 // already celebrated for this user
    if (ratingsCount < UNLOCK_THRESHOLD) return;

    celebratedRef.current = true;
    const dismissAndPersist = () => {
      markSeen()
        .catch(() => { /* non-fatal; profile refetch below is best-effort */ })
        .finally(() => {
          qc.setQueryData(
            ["my-profile", (profile as { id?: string }).id ?? null],
            (old: unknown) => (old && typeof old === "object")
              ? { ...(old as object), scan_unlock_seen: true }
              : old,
          );
          qc.invalidateQueries({ queryKey: ["my-profile"] });
        });
    };
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate?.([12, 40, 24]);
      }
    } catch { /* noop */ }
    toast.success("Scan unlocked", {
      description: "Point your camera at any wine list — I'll rank every bottle.",
      duration: 5000,
      action: {
        label: "Scan now",
        onClick: () => { dismissAndPersist(); navigate({ to: "/" }); },
      },
      // Any dismissal path (auto-close, swipe, tap-away) still persists the flag.
      onDismiss: dismissAndPersist,
      onAutoClose: dismissAndPersist,
    });
    // Optimistic: persist immediately even if the user never touches the toast.
    dismissAndPersist();
  }, [profile, scanUnlockSeen, ratingsCount, navigate, markSeen, qc]);



  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  return (
    <div className="cellar-bg min-h-screen flex flex-col">
      <header
        className="sticky top-0 z-30 px-5 pb-3 flex items-center justify-between bg-background/85 backdrop-blur border-b border-border/60"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
      >
        <Link to="/" className="font-serif text-xl tracking-tight">
          Palate <span className="text-primary">Match</span>
        </Link>

        <div className="flex items-center gap-1" ref={menuRef}>
          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              className="h-11 w-11 rounded-full border border-border bg-card/80 text-xs font-semibold text-foreground hover:bg-accent transition-colors flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {initials}
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-52 rounded-lg border border-border bg-card shadow-xl overflow-hidden z-40"
              >
                <button
                  role="menuitem"
                  onClick={() => { toggle(); setMenuOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-3 text-sm text-foreground hover:bg-accent/60"
                >
                  {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                  {theme === "dark" ? "Light theme" : "Dark theme"}
                </button>
                <Link
                  to="/canons"
                  role="menuitem"
                  className="flex items-center gap-2 px-3 py-3 text-sm text-foreground hover:bg-accent/60 border-t border-border"
                >
                  <Crown size={14} strokeWidth={2.2} fill="currentColor" className="text-primary" />
                  Canon Cellar
                </Link>
                <Link
                  to="/friends"
                  role="menuitem"
                  className="block px-3 py-3 text-sm text-foreground hover:bg-accent/60"
                >
                  Friends
                </Link>
                <button
                  role="menuitem"
                  onClick={async () => { await supabase.auth.signOut(); }}
                  className="w-full text-left px-3 py-3 text-xs text-muted-foreground hover:bg-accent/60 border-t border-border"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 px-5 pb-24 max-w-xl w-full mx-auto">{children}</main>

      <A2HSHint />

      <nav
        className="fixed bottom-0 inset-x-0 border-t border-border bg-background/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="max-w-xl mx-auto flex">
          {TABS.map(({ to, label, Icon }) => {
            const active = isActive(pathname, to);
            return (
              <Link
                key={to}
                to={to}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={`flex-1 flex flex-col items-center justify-center gap-1 min-h-11 py-2.5 text-[11px] transition-colors border-t-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
                  active
                    ? "text-primary border-primary"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
              >
                <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
