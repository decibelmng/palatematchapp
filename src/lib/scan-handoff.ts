/**
 * In-memory hand-off for a photo captured from the SCAN chooser sheet.
 *
 * Why a module global and not router state: iOS Safari only opens the camera
 * from a real user gesture, and the gesture dies across an `await`. So the
 * chooser fires `input.click()` synchronously inside the tap handler, and the
 * captured File has to survive a client-side navigation to the review screen.
 * A File is not serialisable into search params or history state, so it rides
 * in this module instead.
 *
 * It is a subscribable store, NOT a mount-once value. The target screen is
 * frequently already mounted when the chooser fires (the chooser lives in the
 * app shell, so "SCAN → Wine list" while standing on /scan/list is a no-op
 * navigation and no effect re-runs). A mount-only consume left the file
 * pending and the previous attempt's error on screen.
 */
export type CaptureKind = "list" | "bottle";

let pending: { kind: CaptureKind; files: File[] } | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function setPendingCapture(kind: CaptureKind, files: File[]): void {
  pending = { kind, files };
  emit();
}

/** Subscribe to hand-off arrivals. Returns an unsubscribe function. */
export function subscribePendingCapture(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Monotonic token, for useSyncExternalStore. */
export function pendingCaptureVersion(): number {
  return version;
}

/**
 * Is a hand-off for this screen waiting right now? Safe to read during
 * render — it is a plain synchronous read, so a screen can suppress a
 * previous attempt's error on the very first paint after entry, before any
 * effect has run.
 */
export function hasPendingCapture(kind: CaptureKind): boolean {
  return !!pending && pending.kind === kind && pending.files.length > 0;
}

/** Consume the hand-off for this screen. Returns null when nothing is waiting. */
export function takePendingCapture(kind: CaptureKind): File[] | null {
  if (!pending || pending.kind !== kind) return null;
  const { files } = pending;
  pending = null;
  emit();
  return files.length > 0 ? files : null;
}
