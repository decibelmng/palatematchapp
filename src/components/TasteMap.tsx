import { useMemo, useState } from "react";
import type { PaletteType } from "@/lib/palate";
import type { ResolvedLandmark } from "@/hooks/use-landmarks";

export type LovedPoint = {
  key: string;
  bottleId?: string;
  axBody: number;
  axFruit: number;
  stars: number;      // 4 or 5
  name: string;
  producer: string | null;
  region: string | null;
};

type Props = {
  type: PaletteType;
  landmarks: ResolvedLandmark[];
  loved: LovedPoint[];
  showOverlay?: boolean;
  overlayText?: string;
};

const VB = 400;
const PAD_L = 44;
const PAD_R = 20;
const PAD_T = 24;
const PAD_B = 40;
const PLOT_W = VB - PAD_L - PAD_R;
const PLOT_H = VB - PAD_T - PAD_B;

const CLUSTER_MAX_DIAMETER = 0.35; // data-space stopping criterion
const RING_PAD = 0.04;              // data-space padding around max radius
const RING_MIN_R = 0.06;            // data-space minimum radius
const MAX_RINGS = 4;

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Complete-linkage clustering in raw data space.
 * Merges the pair of clusters whose combined diameter (max pairwise distance
 * across all members) is smallest, stopping when that minimum exceeds `maxDiameter`.
 */
function completeLinkage(pts: { x: number; y: number }[], maxDiameter: number) {
  const n = pts.length;
  if (n === 0) return [];

  // Pairwise distance matrix (data space)
  const D: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      D[i][j] = D[j][i] = dist(pts[i], pts[j]);
    }
  }

  // Each cluster tracks its member indices and its current diameter
  let clusters: { members: number[]; diameter: number }[] =
    pts.map((_, i) => ({ members: [i], diameter: 0 }));

  const mergedDiameter = (a: number[], b: number[]) => {
    let d = 0;
    for (const i of a) for (const j of b) if (D[i][j] > d) d = D[i][j];
    return d;
  };

  while (clusters.length > 1) {
    let bestI = -1, bestJ = -1, bestDiam = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const cross = mergedDiameter(clusters[i].members, clusters[j].members);
        const merged = Math.max(clusters[i].diameter, clusters[j].diameter, cross);
        if (merged < bestDiam) { bestDiam = merged; bestI = i; bestJ = j; }
      }
    }
    if (bestDiam > maxDiameter) break;
    const merged = {
      members: [...clusters[bestI].members, ...clusters[bestJ].members],
      diameter: bestDiam,
    };
    clusters = clusters.filter((_, k) => k !== bestI && k !== bestJ);
    clusters.push(merged);
  }

  return clusters.map((c) => {
    const gp = c.members.map((i) => pts[i]);
    const cx = gp.reduce((s, p) => s + p.x, 0) / gp.length;
    const cy = gp.reduce((s, p) => s + p.y, 0) / gp.length;
    const center = { x: cx, y: cy };
    const maxR = gp.reduce((m, p) => Math.max(m, dist(p, center)), 0);
    const radius = Math.max(RING_MIN_R, maxR + RING_PAD); // data-space radius
    return { center, radius, size: gp.length };
  });
}

type Domain = { x0: number; x1: number; y0: number; y1: number };
function computeDomain(pts: { x: number; y: number }[], rings: { center: { x: number; y: number }; radius: number }[] = []): Domain {
  const box: { x: number; y: number }[] = [...pts];
  for (const r of rings) {
    box.push({ x: r.center.x - r.radius, y: r.center.y - r.radius });
    box.push({ x: r.center.x + r.radius, y: r.center.y + r.radius });
  }
  if (box.length === 0) return { x0: 0, x1: 1, y0: 0, y1: 1 };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of box) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  const padX = Math.max(0.04, (x1 - x0) * 0.08);
  const padY = Math.max(0.04, (y1 - y0) * 0.08);
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  const MIN_SPAN = 0.5;
  if (x1 - x0 < MIN_SPAN) {
    const mid = (x0 + x1) / 2;
    x0 = mid - MIN_SPAN / 2; x1 = mid + MIN_SPAN / 2;
  }
  if (y1 - y0 < MIN_SPAN) {
    const mid = (y0 + y1) / 2;
    y0 = mid - MIN_SPAN / 2; y1 = mid + MIN_SPAN / 2;
  }
  return { x0: clamp01(x0), x1: clamp01(x1), y0: clamp01(y0), y1: clamp01(y1) };
}

type Selected =
  | { kind: "loved"; p: LovedPoint }
  | { kind: "landmark"; l: ResolvedLandmark }
  | null;

export function TasteMap({ type, landmarks, loved, showOverlay, overlayText }: Props) {
  const corners = type === "red"
    ? {
        tl: "Light & earthy",   tr: "Bold & earthy",
        bl: "Light & fruity",   br: "Bold & fruity",
        xCap: "Light → Bold",   yCap: "Fruit-forward → Earthy",
      }
    : {
        tl: "Light & mineral",  tr: "Bold & mineral",
        bl: "Light & fruity",   br: "Bold & fruity",
        xCap: "Light → Bold",   yCap: "Fruit-forward → Mineral & savory",
      };

  const [selected, setSelected] = useState<Selected>(null);

  const lovedData = useMemo(
    () => loved.map((p) => ({ p, x: clamp01(p.axBody), y: clamp01(p.axFruit) })),
    [loved]
  );
  const landmarkData = useMemo(
    () => landmarks.map((l) => ({ l, x: clamp01(l.axBody), y: clamp01(l.axFruit) })),
    [landmarks]
  );

  // Cluster the RAW 0..1 (x, y) values, not screen coords.
  const clusters = useMemo(
    () => lovedData.length
      ? completeLinkage(lovedData.map((d) => ({ x: d.x, y: d.y })), CLUSTER_MAX_DIAMETER)
          .sort((a, b) => b.size - a.size)
          .slice(0, MAX_RINGS)
      : [],
    [lovedData]
  );

  const domain = useMemo(
    () => computeDomain(
      [
        ...lovedData.map((d) => ({ x: d.x, y: d.y })),
        ...landmarkData.map((d) => ({ x: d.x, y: d.y })),
      ],
      clusters,
    ),
    [lovedData, landmarkData, clusters]
  );
  const dx = domain.x1 - domain.x0;
  const dy = domain.y1 - domain.y0;
  const toPx = (u: { x: number; y: number }) => ({
    px: PAD_L + ((u.x - domain.x0) / dx) * PLOT_W,
    py: PAD_T + (1 - (u.y - domain.y0) / dy) * PLOT_H,
  });

  const showCrosshair = 0.5 >= domain.x0 && 0.5 <= domain.x1
    && 0.5 >= domain.y0 && 0.5 <= domain.y1;


  const gridOpacity = 0.6;

  const clearOnBg = () => setSelected(null);

  return (
    <div className="w-full max-w-[480px] mx-auto">
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        role="img"
        aria-label="Taste map"
        className="block w-full h-auto touch-manipulation"
        onClick={clearOnBg}
      >
        {/* Plot background — captures background taps to clear selection */}
        <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} rx={10}
          fill="var(--color-card)" stroke="var(--color-border)" strokeWidth={1}
          fillOpacity={0.4} opacity={gridOpacity} />

        {/* Crosshair + quadrant corner labels only when 0.5 is inside the visible domain */}
        {showCrosshair && (
          <g opacity={gridOpacity}>
            {(() => {
              const mid = toPx({ x: 0.5, y: 0.5 });
              return (
                <>
                  <line x1={mid.px} y1={PAD_T} x2={mid.px} y2={PAD_T + PLOT_H}
                    stroke="var(--color-border)" strokeDasharray="3 5" strokeOpacity={0.5} />
                  <line x1={PAD_L} y1={mid.py} x2={PAD_L + PLOT_W} y2={mid.py}
                    stroke="var(--color-border)" strokeDasharray="3 5" strokeOpacity={0.5} />
                </>
              );
            })()}
            <text x={PAD_L + 8} y={PAD_T + 14} fontSize="11" fontStyle="italic"
              fill="var(--color-muted-foreground)">{corners.tl}</text>
            <text x={PAD_L + PLOT_W - 8} y={PAD_T + 14} fontSize="11" fontStyle="italic"
              textAnchor="end" fill="var(--color-muted-foreground)">{corners.tr}</text>
            <text x={PAD_L + 8} y={PAD_T + PLOT_H - 8} fontSize="11" fontStyle="italic"
              fill="var(--color-muted-foreground)">{corners.bl}</text>
            <text x={PAD_L + PLOT_W - 8} y={PAD_T + PLOT_H - 8} fontSize="11" fontStyle="italic"
              textAnchor="end" fill="var(--color-muted-foreground)">{corners.br}</text>
          </g>
        )}

        {/* Axis captions — always visible */}
        <text x={PAD_L + PLOT_W / 2} y={VB - 12} textAnchor="middle" fontSize="12"
          fill="var(--color-muted-foreground)">{corners.xCap}</text>
        <text x={0} y={0}
          transform={`translate(14 ${PAD_T + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle" fontSize="12"
          fill="var(--color-muted-foreground)">{corners.yCap}</text>

        {/* Rings (tier b) — dashed primary 20%, no labels. Data-space radius
            mapped through the auto-fit transform per axis, drawn as an ellipse
            so it truly encloses members even when dx ≠ dy. */}
        {clusters.map((cl, i) => {
          const p = toPx(cl.center);
          const rx = (cl.radius / dx) * PLOT_W;
          const ry = (cl.radius / dy) * PLOT_H;
          return (
            <ellipse key={i} cx={p.px} cy={p.py} rx={rx} ry={ry}
              fill="none"
              stroke="var(--color-primary)"
              strokeOpacity={0.2}
              strokeDasharray="3 6"
              strokeWidth={1.25} />
          );
        })}

        {/* Landmarks (tier c) — hollow */}
        {landmarkData.map(({ l, x, y }) => {
          const p = toPx({ x, y });
          const isSelected = selected?.kind === "landmark" && selected.l.label === l.label;
          return (
            <g key={l.label}
              onClick={(e) => { e.stopPropagation(); setSelected({ kind: "landmark", l }); }}
              style={{ cursor: "pointer" }}>
              <circle cx={p.px} cy={p.py} r={12} fill="transparent" />
              <circle cx={p.px} cy={p.py} r={7}
                fill="var(--color-background)"
                stroke="var(--color-muted-foreground)"
                strokeWidth={isSelected ? 2 : 1.5} />
            </g>
          );
        })}

        {/* Loved wines (tier a) — solid primary; 8px for 5★, 6px for 4★ */}
        {lovedData.map(({ p, x, y }, i) => {
          const px = toPx({ x, y });
          const r = p.stars >= 5 ? 8 : 6;
          const isSelected = selected?.kind === "loved" && selected.p.key === p.key;
          return (
            <g key={p.key + i}
              onClick={(e) => { e.stopPropagation(); setSelected({ kind: "loved", p }); }}
              style={{ cursor: "pointer" }}>
              <circle cx={px.px} cy={px.py} r={12} fill="transparent" />
              <circle cx={px.px} cy={px.py} r={r}
                fill="var(--color-primary)"
                stroke={isSelected ? "var(--color-foreground)" : "none"}
                strokeWidth={isSelected ? 1.5 : 0} />
            </g>
          );
        })}

        {showOverlay && (
          <g>
            <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H}
              fill="var(--color-background)" opacity={0.55} rx={10} />
            <text x={PAD_L + PLOT_W / 2} y={PAD_T + PLOT_H / 2}
              textAnchor="middle" dominantBaseline="central"
              fontFamily="var(--font-serif)" fontSize="15"
              fill="var(--color-foreground)">
              {overlayText ?? "Where do you land?"}
            </text>
          </g>
        )}
      </svg>

      {/* Callout slot — fixed position directly below the plot */}
      <div className="mt-2 min-h-[52px] rounded-md border border-border bg-card/50 px-3 py-2 text-xs">
        {selected ? (
          <Callout selected={selected} />
        ) : (
          <p className="text-muted-foreground text-center">Tap any dot to see the wine</p>
        )}
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-primary" />
          Wines you love
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full border-[1.5px] border-muted-foreground bg-background" />
          Famous landmarks
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="20" height="8" viewBox="0 0 20 8" aria-hidden="true">
            <path d="M1 4 Q 10 -2 19 4" fill="none"
              stroke="var(--color-primary)" strokeOpacity={0.5}
              strokeDasharray="3 3" strokeWidth={1.25} />
          </svg>
          Your taste modes
        </span>
      </div>
    </div>
  );
}

function Callout({ selected }: { selected: NonNullable<Selected> }) {
  if (selected.kind === "loved") {
    const p = selected.p;
    const meta = [p.producer, p.region].filter(Boolean).join(" · ");
    const stars = "★".repeat(p.stars) + "☆".repeat(5 - p.stars);
    return (
      <div>
        <div className="font-medium text-foreground truncate">{p.name}</div>
        {meta && <div className="text-muted-foreground truncate">{meta}</div>}
        <div className="mt-0.5 text-primary">Your rating: {stars}</div>
      </div>
    );
  }
  const l = selected.l;
  return (
    <div>
      <div className="font-medium text-foreground truncate">{l.label}</div>
      <div className="text-muted-foreground truncate">{l.sub}</div>
      <div className="mt-0.5 text-muted-foreground uppercase tracking-[0.15em] text-[10px]">Landmark</div>
    </div>
  );
}
