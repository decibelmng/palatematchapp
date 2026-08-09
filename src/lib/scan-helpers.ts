import type { ResolvedWine } from "@/lib/scan.functions";

export type BatchImage = {
  image_base64: string;
  media_type: "image/jpeg" | "image/png" | "image/webp" | "image/heic";
};

export type BatchState = {
  index: number;
  pageNumbers: number[];
  status: "pending" | "running" | "done" | "failed";
  images: BatchImage[];
  image_paths: string[];
  error?: string;
};

export async function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  const base64 = btoa(binary);
  let mt = file.type || "image/jpeg";
  if (!["image/jpeg", "image/png", "image/webp", "image/heic"].includes(mt)) mt = "image/jpeg";
  return { base64, mediaType: mt };
}

export function chunkArr<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export function rowToResolved(r: any): ResolvedWine {
  return {
    producer: r.producer ?? null,
    wine_name: r.cuvee ?? null,
    vintage: r.vintage ?? null,
    region: r.region ?? null,
    grape: r.grape ?? null,
    price: r.price ?? null,
    type: (r.wine_type ?? null) as any,
    fp: null,
    confidence: null,
    fp_resolved: r.fp ?? null,
    fp_source: (r.fp_source ?? "estimated") as any,
    matched_bottle_id: r.matched_bottle_id ?? null,
    matched_bottle_name: null,
    match_score: r.match_score ?? 0,
    match_reasons: (r.match_reasons ?? []) as string[] | undefined,
    // The approximate-vintage flag lives in match_reasons so a reopened scan
    // reports it the same way the live scan did.
    vintage_approx: Array.isArray(r.match_reasons)
      ? (r.match_reasons as string[]).includes("flag:vintage_approx")
      : false,
    matched_vintage: Array.isArray(r.match_reasons)
      ? (() => {
          const tag = (r.match_reasons as string[]).find((s) => s.startsWith("matched_vintage:"));
          const n = tag ? Number(tag.slice("matched_vintage:".length)) : NaN;
          return Number.isFinite(n) ? n : null;
        })()
      : null,

    // Carry the scan_wines PK. Omitting it here is what silently broke the
    // join from a rating back to the OCR'd line: the resume-in-place path
    // (use-scan-capture) maps stored rows through this function, so a rating
    // after a reload logged scan_wine_id null while the same wine rated
    // during the live scan logged it fine. Callers that used to re-attach it
    // by hand are now redundant rather than load-bearing.
    scan_wine_id: (r.id as string | null) ?? null,
  };
}

