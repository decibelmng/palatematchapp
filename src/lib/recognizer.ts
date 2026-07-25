// Provider-agnostic wine label recognizer interface.
// This exists so the recognition provider is a config-level swap
// (bake-off later against InVintory / FastCork / etc.), not a
// codebase-wide refactor. Today the only implementation is the
// Lovable AI vision LLM (open-set, reads long-tail Burgundies a
// closed labelmap misses, returns structured fields).
//
// The interface intentionally mirrors the shape our current server
// function already returns, so swapping providers only requires
// re-implementing this one adapter.

import type {
  BottleExtract,
  BottleScanResult,
} from "./bottle-scan.functions";

/** One label → one structured read + catalog resolution. */
export type BottleRecognizeInput = {
  images: Array<{
    image_base64: string;
    media_type: "image/jpeg" | "image/png" | "image/webp" | "image/heic";
  }>;
  image_paths?: string[];
};

export interface WineRecognizer {
  /** Read a single bottle label (front, or front+back). */
  recognizeBottle(input: BottleRecognizeInput): Promise<BottleScanResult>;
  /** Human-readable provider tag, e.g. for the "help us name this" tile. */
  readonly provider: string;
}

/**
 * Lovable AI vision-LLM recognizer.
 * Pass in the bound server-fn from `useServerFn(scanBottleLabel)`
 * so this stays a thin adapter — no direct network coupling.
 */
export function createLovableVisionRecognizer(
  scanFn: (args: { data: BottleRecognizeInput }) => Promise<BottleScanResult>,
): WineRecognizer {
  return {
    provider: "lovable-vision-llm",
    recognizeBottle: (input) => scanFn({ data: input }),
  };
}

/** Convenience re-export so consumers don't reach into bottle-scan.functions.ts. */
export type { BottleExtract, BottleScanResult };
