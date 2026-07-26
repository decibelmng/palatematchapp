import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Minimal Add-to-Home-Screen guidance.
 *  - Android/Chrome/Edge: uses the native `beforeinstallprompt` when available.
 *  - iOS Safari: shows the tap-Share → Add to Home Screen hint.
 *  - Renders nothing when the app is already running as an installed PWA.
 */
export function InstallGuidance() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop" | "unknown">("unknown");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    const ua = window.navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) setPlatform("ios");
    else if (/Android/i.test(ua)) setPlatform("android");
    else setPlatform("desktop");

    const onBip = (e: Event) => { e.preventDefault(); setDeferred(e as BIPEvent); };
    window.addEventListener("beforeinstallprompt", onBip as EventListener);
    const onInstalled = () => setInstalled(true);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip as EventListener);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 text-sm">
      <div className="font-medium mb-1">Get Palate Match</div>
      {deferred ? (
        <>
          <p className="text-muted-foreground mb-3">
            Install the app in one tap — you'll land here already connected.
          </p>
          <button
            type="button"
            onClick={async () => { try { await deferred.prompt(); await deferred.userChoice; } catch { /* noop */ } }}
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs"
          >
            Install
          </button>
        </>
      ) : platform === "ios" ? (
        <p className="text-muted-foreground">
          On iPhone: tap the <span className="font-medium">Share</span> icon in Safari, then
          <span className="font-medium"> Add to Home Screen</span>. Open the app from your home screen and
          you'll land here connected.
        </p>
      ) : platform === "android" ? (
        <p className="text-muted-foreground">
          In Chrome, tap the <span className="font-medium">⋮ menu</span> and choose
          <span className="font-medium"> Add to Home screen</span>. Reopen from the icon to stay connected.
        </p>
      ) : (
        <p className="text-muted-foreground">
          In your browser's menu, choose <span className="font-medium">Install app</span> (or
          <span className="font-medium"> Add to Home Screen</span>) to keep the connection.
        </p>
      )}
    </div>
  );
}
