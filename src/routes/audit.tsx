import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/audit")({
  ssr: false,
  component: AuditPage,
});

type Pair = { fg: string; bg: string; where: string; ratio: number; pass: boolean; minRatio: number };
type Tap = { tag: string; label: string; w: number; h: number; pass: boolean };

function toRgb(color: string): [number, number, number] | null {
  // Handle #rrggbb, rgb(), rgba(), rgb(...  / a)
  const el = document.createElement("div");
  el.style.color = color;
  document.body.appendChild(el);
  const parsed = getComputedStyle(el).color;
  document.body.removeChild(el);
  const m = parsed.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2]];
}
function relLum([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: string, b: string): number {
  const ra = toRgb(a), rb = toRgb(b);
  if (!ra || !rb) return 0;
  const la = relLum(ra), lb = relLum(rb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
function bgOf(el: Element): string {
  let node: Element | null = el;
  while (node) {
    const c = getComputedStyle(node).backgroundColor;
    if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c;
    node = node.parentElement;
  }
  return getComputedStyle(document.body).backgroundColor;
}

function AuditPage() {
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 250); return () => clearTimeout(t); }, []);

  const results = useMemo(() => {
    if (!ready) return null;
    // 1. Contrast — sample text nodes across the whole DOM
    const seen = new Map<string, Pair>();
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    for (const el of nodes) {
      if (el.closest("[data-audit-ignore]")) continue;
      const text = (el.textContent ?? "").trim();
      if (!text) continue;
      // Only leaf-ish nodes (avoid double-counting)
      const hasTextChild = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent && n.textContent.trim());
      if (!hasTextChild) continue;
      const cs = getComputedStyle(el);
      const fg = cs.color;
      const bg = bgOf(el);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight || "400", 10);
      const large = size >= 24 || (size >= 18 && weight >= 700);
      const minRatio = large ? 4.5 : 7.0;
      const key = `${fg}|${bg}`;
      if (seen.has(key)) continue;
      const ratio = Math.round(contrast(fg, bg) * 100) / 100;
      seen.set(key, { fg, bg, where: el.tagName.toLowerCase(), ratio, pass: ratio >= minRatio, minRatio });
    }
    const contrastPairs = Array.from(seen.values()).sort((a, b) => a.ratio - b.ratio);

    // 2. Type scale
    const sizeSet = new Set<string>();
    for (const el of nodes) {
      const t = (el.textContent ?? "").trim();
      if (!t) continue;
      const hasTextChild = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent && n.textContent.trim());
      if (!hasTextChild) continue;
      const cs = getComputedStyle(el);
      const family = cs.fontFamily.toLowerCase();
      // Exclude serif display sizes (palate code + wordmark)
      if (family.includes("cormorant") || family.includes("garamond")) continue;
      sizeSet.add(cs.fontSize);
    }
    const sizes = Array.from(sizeSet).sort((a, b) => parseFloat(a) - parseFloat(b));

    // 3. Tap targets
    const taps: Tap[] = [];
    const clickable = Array.from(
      document.querySelectorAll<HTMLElement>('button, a, [role="button"], [role="menuitem"], input[type=checkbox], input[type=radio], select'),
    );
    for (const el of clickable) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      taps.push({
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
        pass: r.width >= 44 && r.height >= 44,
      });
    }
    taps.sort((a, b) => Math.min(a.w, a.h) - Math.min(b.w, b.h));

    // 4. Standalone
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    return { contrastPairs, sizes, taps, standalone };
  }, [ready]);

  useEffect(() => {
    if (!results) return;
    console.groupCollapsed("[__audit] Phase 1 acceptance");
    console.log("contrast pairs:", results.contrastPairs);
    console.log("distinct font sizes (excl. serif display):", results.sizes);
    console.log("tap targets (sorted by smallest side):", results.taps);
    console.log("standalone:", results.standalone);
    console.groupEnd();
  }, [results]);

  if (!results) return <div className="p-6 text-sm text-muted-foreground">Sampling…</div>;

  const contrastFails = results.contrastPairs.filter((p) => !p.pass);
  const tapFails = results.taps.filter((t) => !t.pass);
  const typePass = results.sizes.length <= 3;

  const badge = (ok: boolean) =>
    <span className={`inline-block rounded px-2 py-0.5 text-[11px] font-semibold ${ok ? "bg-[--color-value] text-black" : "bg-destructive text-destructive-foreground"}`}>{ok ? "PASS" : "FAIL"}</span>;

  return (
    <div className="p-4 space-y-6 text-sm">
      <h1 className="font-serif text-2xl">Phase 1 audit</h1>
      <p className="text-xs text-muted-foreground">Open on a real route (e.g. /matches) via link below to sample that DOM. This route samples whatever is behind it — navigate away and back to re-sample.</p>

      <section>
        <h2 className="font-semibold mb-2">1. Contrast {badge(contrastFails.length === 0)}</h2>
        <p className="text-xs text-muted-foreground mb-2">Threshold: ≥7.0:1 body, ≥4.5:1 large/bold. Failing pairs first.</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead><tr className="text-left"><th>fg</th><th>bg</th><th>ratio</th><th>min</th><th>pass</th></tr></thead>
            <tbody>
              {[...contrastFails, ...results.contrastPairs.filter((p) => p.pass).slice(0, 8)].map((p, i) => (
                <tr key={i} className="border-t border-border">
                  <td><span className="inline-block h-3 w-3 mr-1 align-middle border border-border" style={{ background: p.fg }} />{p.fg}</td>
                  <td><span className="inline-block h-3 w-3 mr-1 align-middle border border-border" style={{ background: p.bg }} />{p.bg}</td>
                  <td>{p.ratio.toFixed(2)}</td>
                  <td>{p.minRatio}</td>
                  <td>{p.pass ? "✓" : "✕"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-2">2. Type scale {badge(typePass)}</h2>
        <p className="text-xs text-muted-foreground mb-2">≤3 distinct sans sizes (excluding serif display).</p>
        <div className="flex flex-wrap gap-2">
          {results.sizes.map((s) => <span key={s} className="rounded border border-border px-2 py-0.5 text-xs">{s}</span>)}
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-2">3. Tap targets {badge(tapFails.length === 0)}</h2>
        <p className="text-xs text-muted-foreground mb-2">Min 44×44px on both axes. Smallest first.</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead><tr className="text-left"><th>tag</th><th>label</th><th>w×h</th><th>pass</th></tr></thead>
            <tbody>
              {results.taps.slice(0, 30).map((t, i) => (
                <tr key={i} className="border-t border-border">
                  <td>{t.tag}</td>
                  <td className="truncate max-w-[16rem]">{t.label}</td>
                  <td>{t.w}×{t.h}</td>
                  <td>{t.pass ? "✓" : "✕"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="font-semibold mb-2">4. Standalone {badge(results.standalone)}</h2>
        <p className="text-xs">display-mode: <code>{String(results.standalone)}</code></p>
      </section>
    </div>
  );
}
