// Downscale a phone photo before it goes to the vision model.
//
// Why this exists: raw phone captures are 3–8 MB, 4000+px wide. Gemini
// (and every other vision model) internally resamples to ~1024–1568 px
// on the long edge before it looks at anything, so shipping the raw
// bytes only spends latency on base64 encode + upload + server transit
// — recognition quality does NOT improve from feeding it a bigger file.
// Downscaling client-side to 1600px @ q=0.82 typically cuts payload
// ~15× and end-to-end scan time roughly in half on 4G.
//
// HEIC from iOS <input type="file"> already arrives as JPEG in most
// browsers; if the browser can't decode it (rare), we fall back to
// shipping the original bytes so we never make the scan fail.

const MAX_EDGE = 1600;
const QUALITY = 0.82;

export type PreparedImage = {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/heic";
  /** The (possibly downscaled) blob — use this for storage upload so
   *  Storage and the vision call ship the same bytes. */
  blob: Blob;
};

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

function pickMediaType(file: File): PreparedImage["mediaType"] {
  const t = (file.type || "").toLowerCase();
  if (t === "image/png") return "image/png";
  if (t === "image/webp") return "image/webp";
  if (t === "image/heic" || t === "image/heif") return "image/heic";
  return "image/jpeg";
}

export async function prepareImageForScan(file: File): Promise<PreparedImage> {
  const originalType = pickMediaType(file);

  // Fast path: tiny files aren't worth re-encoding.
  if (file.size < 400_000) {
    return { base64: await blobToBase64(file), mediaType: originalType, blob: file };
  }

  // Try createImageBitmap first — it handles EXIF orientation and is
  // faster than <img>. Fall back to <img> for browsers that don't
  // support it well (older Safari).
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as any);
  } catch {
    bitmap = null;
  }

  let width: number, height: number;
  let source: CanvasImageSource;

  if (bitmap) {
    width = bitmap.width;
    height = bitmap.height;
    source = bitmap;
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image decode failed"));
        el.src = url;
      });
      width = img.naturalWidth;
      height = img.naturalHeight;
      source = img;
    } catch {
      // Can't decode — ship original.
      URL.revokeObjectURL(url);
      return { base64: await blobToBase64(file), mediaType: originalType, blob: file };
    } finally {
      // URL revoked lazily; browser holds a ref while <img> is alive.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_EDGE) {
    // Already small enough — no re-encode.
    if (bitmap) bitmap.close?.();
    return { base64: await blobToBase64(file), mediaType: originalType, blob: file };
  }

  const scale = MAX_EDGE / longEdge;
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    if (bitmap) bitmap.close?.();
    return { base64: await blobToBase64(file), mediaType: originalType, blob: file };
  }
  ctx.drawImage(source, 0, 0, w, h);
  if (bitmap) bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", QUALITY),
  );
  if (!blob) {
    return { base64: await blobToBase64(file), mediaType: originalType, blob: file };
  }
  return { base64: await blobToBase64(blob), mediaType: "image/jpeg", blob };
}
