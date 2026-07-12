import { useEffect, useRef, useState } from "react";
import { PalateStar, lettersFromCode } from "./PalateStar";
import { axesFor, type PaletteType } from "@/lib/palate";
import { useSommelierBrief } from "@/hooks/use-sommelier-brief";
import { SommelierBriefCard } from "./SommelierBriefCard";

type Props = {
  open: boolean;
  onClose: () => void;
  type: PaletteType;
  code: string;
  displayName: string;
};

export function ShareCardDialog({ open, onClose, type, code, displayName }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const letters = lettersFromCode(code, axesFor(type));
  const brief = useSommelierBrief();

  useEffect(() => { if (!open) setMsg(null); }, [open]);

  if (!open) return null;

  const exportPng = async (mode: "copy" | "download") => {
    const svg = cardRef.current?.querySelector("svg");
    if (!svg) return;
    try {
      const png = await renderCardToPng(cardRef.current!, svg as SVGSVGElement);
      if (mode === "copy" && typeof (window as any).ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        try {
          await navigator.clipboard.write([
            new (window as any).ClipboardItem({ "image/png": png }),
          ]);
          setMsg("Image copied.");
          return;
        } catch { /* fall through to download */ }
      }
      const url = URL.createObjectURL(png);
      const a = document.createElement("a");
      a.href = url;
      a.download = `palate-${type}-${code}.png`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg("Image downloaded.");
    } catch (e) {
      setMsg("Couldn't export image.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div ref={cardRef} className="rounded-xl bg-background border border-border p-6 flex flex-col items-center text-center">
          <PalateStar axes={axesFor(type)} letters={letters} size={200} />
          <div
            className="mt-4 font-serif text-2xl text-primary"
            style={{ letterSpacing: "0.3em" }}
          >
            {code.split("").map((c, i) => (
              <span key={i} className={c === "·" ? "text-muted-foreground/60" : ""}>{c}</span>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            My {type} palate · Palate Match
          </p>
          {displayName && (
            <p className="mt-1 text-sm font-medium">{displayName}</p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => exportPng("copy")}
            className="flex-1 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90"
          >
            Copy image
          </button>
          <button
            onClick={() => exportPng("download")}
            className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Download
          </button>
        </div>
        {msg && <p className="mt-2 text-xs text-muted-foreground text-center">{msg}</p>}

        {brief.text && <SommelierBriefCard brief={brief} />}


        <button
          onClick={onClose}
          className="mt-3 w-full text-xs text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** Render an HTML card (containing an SVG) to a PNG Blob using an offscreen canvas. */
async function renderCardToPng(card: HTMLElement, svg: SVGSVGElement): Promise<Blob> {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = card.getBoundingClientRect();
  const W = Math.ceil(rect.width);
  const H = Math.ceil(rect.height);

  // Read computed colors so the exported PNG matches the visible card.
  const cs = getComputedStyle(card);
  const bg = cs.backgroundColor || "#111";
  const border = cs.borderColor || "#333";
  const fg = getComputedStyle(document.documentElement).getPropertyValue("--color-foreground") || "#eee";
  const primary = getComputedStyle(document.documentElement).getPropertyValue("--color-primary") || "#c33";
  const muted = getComputedStyle(document.documentElement).getPropertyValue("--color-muted-foreground") || "#888";

  // Inline the SVG dimensions
  const svgCloned = svg.cloneNode(true) as SVGSVGElement;
  const svgSize = 200;
  svgCloned.setAttribute("width", String(svgSize));
  svgCloned.setAttribute("height", String(svgSize));
  // Replace CSS variable references with computed values so the raster is correct
  const xml = new XMLSerializer().serializeToString(svgCloned)
    .replace(/var\(--color-primary\)/g, primary.trim() || "#c33")
    .replace(/var\(--color-border\)/g, border || "#333")
    .replace(/var\(--color-background\)/g, bg || "#111")
    .replace(/var\(--color-muted-foreground\)/g, muted.trim() || "#888");

  const svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);
  const img = await loadImage(svgUrl);
  URL.revokeObjectURL(svgUrl);

  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  // Card background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Draw SVG glyph centered in top region
  const gx = (W - svgSize) / 2;
  const gy = 24;
  ctx.drawImage(img, gx, gy, svgSize, svgSize);

  // Extract the text lines directly from the card so we don't duplicate copy.
  const paragraphs = Array.from(card.querySelectorAll("p,div"))
    .map((el) => el.textContent?.trim() || "")
    .filter(Boolean);

  // Code line
  ctx.textAlign = "center";
  ctx.fillStyle = primary.trim() || "#c33";
  ctx.font = "600 28px ui-serif, Georgia, serif";
  const codeText = card.querySelector("div.font-serif")?.textContent || "";
  ctx.fillText(spaceOut(codeText), W / 2, gy + svgSize + 40);

  // "My {type} palate · Palate Match"
  ctx.fillStyle = muted.trim() || "#888";
  ctx.font = "400 12px ui-sans-serif, system-ui, sans-serif";
  const meta = paragraphs.find((t) => t.includes("Palate Match")) || "";
  if (meta) ctx.fillText(meta, W / 2, gy + svgSize + 66);

  // display name
  ctx.fillStyle = fg.trim() || "#eee";
  ctx.font = "500 14px ui-sans-serif, system-ui, sans-serif";
  const name = paragraphs.find((t) => t && !t.includes("Palate Match") && t !== codeText);
  if (name) ctx.fillText(name, W / 2, gy + svgSize + 88);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
  );
}

function spaceOut(s: string): string {
  return s.split("").join("  ");
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
