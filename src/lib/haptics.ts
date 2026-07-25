// Light haptic pulse for confirmation taps in decision surfaces.
// No-op on unsupported devices / when reduced motion is on.
export function haptic(kind: "light" | "select" | "success" = "light"): void {
  if (typeof window === "undefined") return;
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    if (typeof nav.vibrate !== "function") return;
    const pat = kind === "success" ? [10, 40, 10] : kind === "select" ? 12 : 8;
    nav.vibrate(pat);
  } catch { /* noop */ }
}
