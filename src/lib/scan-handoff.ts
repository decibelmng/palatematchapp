/**
 * In-memory hand-off for a photo captured from the SCAN chooser sheet.
 *
 * Why a module global and not router state: iOS Safari only opens the camera
 * from a real user gesture, and the gesture dies across an `await`. So the
 * chooser fires `input.click()` synchronously inside the tap handler, and the
 * captured File has to survive a client-side navigation to the review screen.
 * A File is not serialisable into search params or history state, so it rides
 * in this module instead. It is consumed exactly once, on the target screen's
 * first effect, then dropped.
 */
export type CaptureKind = "list" | "bottle";

let pending: { kind: CaptureKind; files: File[] } | null = null;

export function setPendingCapture(kind: CaptureKind, files: File[]): void {
  pending = { kind, files };
}

/** Consume the hand-off for this screen. Returns null when nothing is waiting. */
export function takePendingCapture(kind: CaptureKind): File[] | null {
  if (!pending || pending.kind !== kind) return null;
  const { files } = pending;
  pending = null;
  return files.length > 0 ? files : null;
}
