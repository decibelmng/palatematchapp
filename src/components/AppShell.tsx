import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScanLine, Star, Users, Library, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useMyProfile, useFriendships } from "@/hooks/use-friends";
import { useLastSeenPing } from "@/hooks/use-last-seen";
import { useAutoRedeemInvite } from "@/hooks/use-auto-redeem-invite";
import { markScanUnlockSeen } from "@/lib/friends.functions";
import { useCalibrationState } from "@/hooks/use-calibration";
import { useFeedActivity, hasFreshActivity } from "@/hooks/use-feed";
import { ScanChooserSheet } from "@/components/ScanChooserSheet";
import { useOnline } from "@/hooks/use-online";

// The four primary destinations. Scan is the raised center button, so only
// three flat tabs render on either side of it. Everyone gets the same nav
// except that verified sommeliers see "Table" instead of "Feed" in the
// right-most slot.
type TabTo = "/palate" | "/wines" | "/feed" | "/somm/table";
type FlatTab = { to: TabTo; label: string; Icon: typeof Star };

const LEFT_TABS: ReadonlyArray<FlatTab> = [
  { to: "/palate", label: "Palate", Icon: Star },
  { to: "/wines", label: "Cellar", Icon: Library },
];

// Route → active-tab resolver. Every route in the app maps to exactly one
// primary destination — no route can render with zero tabs active.
// The center Scan button is a modal, not a route, so /scan/* correctly
// resolves to no highlighted tab (the raised button stands alone).
function activeTabFor(pathname: string, sommRight: TabTo): TabTo | null {
  // Palate group: profile, rate, onboarding, calibration.
  if (pathname === "/palate" || pathname.startsWith("/palate/")) return "/palate";
  if (pathname === "/rate" || pathname.startsWith("/rate/")) return "/palate";
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return "/palate";

  // Cellar group: wines list, per-wine detail, favorites/avoid, wishlist, past scans.
  if (pathname === "/wines" || pathname.startsWith("/wines/")) return "/wines";
  if (pathname === "/wine" || pathname.startsWith("/wine/")) return "/wines";
  if (pathname === "/canons") return "/wines";
  if (pathname === "/wishlist") return "/wines";
  if (pathname === "/scans" || pathname.startsWith("/scans/")) return "/wines";

  // Right slot: Feed for guests, Table for sommeliers. All social routes
  // resolve to whichever tab that user currently sees there.
  if (pathname === "/feed" || pathname.startsWith("/feed/")) return sommRight;
  if (pathname === "/friends" || pathname.startsWith("/friends/")) return sommRight;
  if (pathname === "/u" || pathname.startsWith("/u/")) return sommRight;
  if (pathname === "/somm" || pathname.startsWith("/somm/")) return sommRight;

  // Scan flows are the center button — no flat tab lights up. Return null
  // rather than a fallback so we never mis-highlight.
  return null;
}

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 flex items-center gap-2 bg-amber-500/95 text-black px-4 py-2 text-meta font-medium"
    >
      <WifiOff size={14} strokeWidth={2.2} />
      Offline — showing your last scan.
    </div>
  );
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
          <div className="font-medium text-foreground">Add Palate Match to your home screen</div>
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
  const [scanOpen, setScanOpen] = useState(false);
  const { data: profile } = useMyProfile();
  useLastSeenPing((profile as { id?: string } | undefined)?.id);
  useAutoRedeemInvite();

  // Feed is the 4th tab for EVERYONE — a verified somm is still a drinker and
  // wants their feed. "Call the table" lives in the center Scan chooser instead
  // of replacing Feed, so somms get both.
  const isVerifiedSomm =
    (profile as { somm_status?: string } | undefined)?.somm_status === "verified";
  const rightTab: FlatTab = { to: "/feed", label: "Feed", Icon: Users };
  const active = activeTabFor(pathname, rightTab.to);

  const { data: feedActivity } = useFeedActivity();
  const feedLatestAt = feedActivity?.latest_at ?? null;
  const { data: allFriendships = [] } = useFriendships();
  const pendingIncoming = allFriendships.filter(
    (f) => f.status === "pending" && f.direction === "incoming",
  ).length;

  // Unlock celebration: fire exactly once per user, ever. Gated on the
  // server-persisted profiles.scan_unlock_seen flag so it survives reloads
  // and new devices. Toast copy is plain — no jargon, one sentence, one
  // action.
  const { calibrated } = useCalibrationState();
  const celebratedRef = useRef(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const markSeen = useServerFn(markScanUnlockSeen);
  const scanUnlockSeen = (profile as { scan_unlock_seen?: boolean } | undefined)?.scan_unlock_seen;
  useEffect(() => {
    if (!profile) return;
    if (celebratedRef.current) return;
    if (scanUnlockSeen) return;
    if (!calibrated) return;

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
    toast.success("You're set — scan any wine list to see it ranked.", {
      duration: 5000,
      action: {
        label: "Scan now",
        onClick: () => { dismissAndPersist(); setScanOpen(true); },
      },
      onDismiss: dismissAndPersist,
      onAutoClose: dismissAndPersist,
    });
    dismissAndPersist();
  }, [profile, scanUnlockSeen, calibrated, navigate, markSeen, qc]);

  return (
    <div className="cellar-bg min-h-screen flex flex-col">
      <OfflineBanner />
      <header
        className="sticky top-0 z-30 px-5 pb-3 flex items-center justify-between bg-background/85 backdrop-blur border-b border-border/60"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
      >
        <Link to="/palate" className="font-serif text-xl tracking-tight">
          Palate <span className="text-primary">Match</span>
        </Link>
        {/* Header actions are gone. Theme, feedback, sign-out, past scans
            and friends now live on /palate under "Account". One place, one
            spec. */}
      </header>

      <main
        className="flex-1 px-5 max-w-xl w-full mx-auto"
        /* Bottom nav height (64px) + raised scan button overhang + the device
           safe-area inset. Without the inset the last card clips behind the nav. */
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6.5rem)" }}
      >
        {children}
      </main>

      <A2HSHint />

      <ScanChooserSheet open={scanOpen} onClose={() => setScanOpen(false)} sommVerified={isVerifiedSomm} />

      <nav
        className="fixed bottom-0 inset-x-0 border-t border-border bg-background/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        aria-label="Primary"
      >
        <div className="max-w-xl mx-auto grid grid-cols-4 items-end">
          {LEFT_TABS.map(({ to, label, Icon }) => {
            const isActive = active === to;
            return (
              <Link
                key={to}
                to={to}
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 min-h-11 py-2.5 text-meta transition-colors border-t-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
                  isActive
                    ? "text-primary border-primary"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
              >
                <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                {label}
              </Link>
            );
          })}

          {/* Center raised SCAN button. Not a route — a modal launcher. */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              aria-label="Scan"
              className="-mt-6 h-16 w-16 rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background flex flex-col items-center justify-center active:scale-95 transition"
            >
              <ScanLine size={24} strokeWidth={2} />
              <span className="text-meta font-semibold uppercase tracking-label mt-0.5">Scan</span>
            </button>
          </div>

          {(() => {
            const { to, label, Icon } = rightTab;
            const isActive = active === to;
            const isFeed = to === "/feed";
            const showBadge = isFeed && pendingIncoming > 0;
            const showDot = isFeed && !showBadge && hasFreshActivity(feedLatestAt);
            return (
              <Link
                to={to}
                aria-label={
                  showBadge
                    ? `${label} — ${pendingIncoming} pending friend request${pendingIncoming === 1 ? "" : "s"}`
                    : label
                }
                aria-current={isActive ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 min-h-11 py-2.5 text-meta transition-colors border-t-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
                  isActive
                    ? "text-primary border-primary"
                    : "text-muted-foreground hover:text-foreground border-transparent"
                }`}
              >
                <span className="relative">
                  <Icon size={18} strokeWidth={isActive ? 2.2 : 1.8} />
                  {showBadge && (
                    <span
                      aria-hidden
                      className="absolute -top-1.5 -right-2 h-4 min-w-4 rounded-full bg-primary text-primary-foreground text-meta font-semibold px-1 flex items-center justify-center ring-2 ring-background"
                    >
                      {pendingIncoming > 9 ? "9+" : pendingIncoming}
                    </span>
                  )}
                  {showDot && (
                    <span
                      aria-label="new activity"
                      className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
                    />
                  )}
                </span>
                {label}
              </Link>
            );
          })()}
        </div>
      </nav>
    </div>
  );
}
