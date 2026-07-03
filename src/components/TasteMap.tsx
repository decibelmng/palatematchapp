import type { PaletteType } from "@/lib/palate";
import type { FpKey } from "@/lib/recommender";
import type { ResolvedLandmark } from "@/hooks/use-landmarks";

export type LovedPoint = {
  key: string;
  fp: Record<FpKey, number>;
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

function coordFor(type: PaletteType, fp: Record<FpKey, number>) {
  const x = type === "red" ? (fp.body + fp.tannin) / 2 : (fp.body + fp.oak) / 2;
  const y = fp.savory;
  return { x: clamp01(x), y: clamp01(y) };
}
function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }

function toPx(u: { x: number; y: number }) {
  return {
    px: PAD_L + u.x * PLOT_W,
    // y inverted: 1 (savory) at top
    py: PAD_T + (1 - u.y) * PLOT_H,
  };
}

// simple 2-means, a handful of iterations
function twoMeans(pts: { x: number; y: number }[]) {
  if (pts.length < 2) {
    if (pts.length === 0) return null;
    return { centers: [pts[0]], assignments: [0], spreads: [0.05] };
  }
  // seed: farthest pair
  let a = 0, b = 1, best = -1;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = dist(pts[i], pts[j]);
      if (d > best) { best = d; a = i; b = j; }
    }
  }
  let c0 = { ...pts[a] };
  let c1 = { ...pts[b] };
  let assign = new Array(pts.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    assign = pts.map((p) => (dist(p, c0) <= dist(p, c1) ? 0 : 1));
    const g0 = pts.filter((_, i) => assign[i] === 0);
    const g1 = pts.filter((_, i) => assign[i] === 1);
    if (g0.length) c0 = centroid(g0);
    if (g1.length) c1 = centroid(g1);
  }
  const g0 = pts.filter((_, i) => assign[i] === 0);
  const g1 = pts.filter((_, i) => assign[i] === 1);
  const s0 = g0.length ? avgDist(g0, c0) : 0;
  const s1 = g1.length ? avgDist(g1, c1) : 0;
  const sep = dist(c0, c1);
  if (sep < 0.28 || g0.length === 0 || g1.length === 0) {
    const c = centroid(pts);
    return { centers: [c], assignments: assign.map(() => 0), spreads: [avgDist(pts, c)] };
  }
  return { centers: [c0, c1], assignments: assign, spreads: [s0, s1] };
}
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function centroid(pts: { x: number; y: number }[]) {
  const x = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { x, y };
}
function avgDist(pts: { x: number; y: number }[], c: { x: number; y: number }) {
  return pts.reduce((s, p) => s + dist(p, c), 0) / pts.length;
}

export function TasteMap({ type, landmarks, loved, showOverlay, overlayText }: Props) {
  const corners = type === "red"
    ? {
        tl: "Delicate & savory",
        tr: "Powerful & savory",
        bl: "Delicate & fruity",
        br: "Powerful & fruity",
        xCap: "Delicate → Powerful",
        yCap: "Fruit → Savory",
      }
    : {
        tl: "Crisp & mineral",
        tr: "Rich & mineral",
        bl: "Crisp & fruity",
        br: "Rich & fruity",
        xCap: "Crisp → Rich",
        yCap: "Fruit → Mineral",
      };

  // Landmark coords + label side selection
  const lmData = landmarks.map((l) => {
    const c = coordFor(type, l.fp);
    const p = toPx(c);
    return { ...l, ...c, ...p };
  });

  // simple collision: track occupied label rects; if overlap, place below
  const labelPositions = placeLabels(lmData);

  // Loved user points → clusters
  const lovedCoords = loved.map((p) => coordFor(type, p.fp));
  const clusters = lovedCoords.length ? twoMeans(lovedCoords) : null;

  return (
    <div className="w-full max-w-[420px] mx-auto">
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        role="img"
        aria-label="Taste map"
        className="block w-full h-auto"
      >
        {/* Plot area */}
        <rect
          x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H}
          rx={10}
          fill="var(--color-card)"
          stroke="var(--color-border)"
          strokeWidth={1}
          fillOpacity={0.4}
        />
        {/* Crosshair */}
        <line x1={PAD_L + PLOT_W / 2} y1={PAD_T} x2={PAD_L + PLOT_W / 2} y2={PAD_T + PLOT_H}
          stroke="var(--color-border)" strokeDasharray="3 5" strokeOpacity={0.5} />
        <line x1={PAD_L} y1={PAD_T + PLOT_H / 2} x2={PAD_L + PLOT_W} y2={PAD_T + PLOT_H / 2}
          stroke="var(--color-border)" strokeDasharray="3 5" strokeOpacity={0.5} />

        {/* Corner labels */}
        <text x={PAD_L + 8} y={PAD_T + 14} fontSize="11" fontStyle="italic"
          fill="var(--color-muted-foreground)">{corners.tl}</text>
        <text x={PAD_L + PLOT_W - 8} y={PAD_T + 14} fontSize="11" fontStyle="italic"
          textAnchor="end" fill="var(--color-muted-foreground)">{corners.tr}</text>
        <text x={PAD_L + 8} y={PAD_T + PLOT_H - 8} fontSize="11" fontStyle="italic"
          fill="var(--color-muted-foreground)">{corners.bl}</text>
        <text x={PAD_L + PLOT_W - 8} y={PAD_T + PLOT_H - 8} fontSize="11" fontStyle="italic"
          textAnchor="end" fill="var(--color-muted-foreground)">{corners.br}</text>

        {/* Axis captions */}
        <text x={PAD_L + PLOT_W / 2} y={VB - 12} textAnchor="middle" fontSize="12"
          fill="var(--color-muted-foreground)">{corners.xCap}</text>
        <text
          x={0} y={0}
          transform={`translate(14 ${PAD_T + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle" fontSize="12"
          fill="var(--color-muted-foreground)"
        >
          {corners.yCap}
        </text>

        {/* Landmarks */}
        {lmData.map((l, i) => {
          const lp = labelPositions[i];
          return (
            <g key={l.label}>
              <circle cx={l.px} cy={l.py} r={4}
                fill="var(--color-muted-foreground)" opacity={0.6} />
              <text x={lp.lx} y={lp.ly} textAnchor={lp.anchor} fontSize="12"
                fill="var(--color-foreground)" fontWeight={500}>
                {l.label}
              </text>
              <text x={lp.lx} y={lp.ly + 12} textAnchor={lp.anchor} fontSize="11"
                fill="var(--color-muted-foreground)">
                {l.sub}
              </text>
            </g>
          );
        })}

        {/* User loved dots */}
        {lovedCoords.map((c, i) => {
          const p = toPx(c);
          return (
            <circle key={i} cx={p.px} cy={p.py} r={4}
              fill="var(--color-primary)" opacity={0.85} />
          );
        })}

        {/* Cluster rings */}
        {clusters && clusters.centers.map((c, i) => {
          const p = toPx(c);
          const spread = clusters.spreads[i] ?? 0.05;
          // radius: min 12% / max 20% of plot width, scaled by spread
          const rNorm = Math.max(0.12, Math.min(0.2, 0.12 + spread * 0.9));
          const r = rNorm * PLOT_W;
          return (
            <g key={i}>
              <circle cx={p.px} cy={p.py} r={r}
                fill="none"
                stroke="var(--color-primary)"
                strokeOpacity={0.3}
                strokeDasharray="4 4"
                strokeWidth={1.5}
              />
              <text
                x={p.px} y={p.py - r - 4}
                textAnchor="middle" fontSize="12" fontWeight={600}
                fill="var(--color-primary)"
              >
                You
              </text>
            </g>
          );
        })}

        {/* Onboarding overlay */}
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
    </div>
  );
}

type LabelPos = { lx: number; ly: number; anchor: "start" | "end" | "middle" };
function placeLabels(lm: { px: number; py: number; label: string }[]): LabelPos[] {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: LabelPos[] = [];
  const LINE_H = 14;
  for (const l of lm) {
    const preferRight = l.px < PAD_L + PLOT_W * 0.75;
    let anchor: LabelPos["anchor"] = preferRight ? "start" : "end";
    let lx = preferRight ? l.px + 6 : l.px - 6;
    let ly = l.py - 2;
    const approxW = Math.max(60, l.label.length * 6.5);
    let rect = { x: anchor === "start" ? lx : lx - approxW, y: ly - 10, w: approxW, h: LINE_H * 2 };
    const overlaps = () => placed.some((p) =>
      !(rect.x + rect.w < p.x || p.x + p.w < rect.x || rect.y + rect.h < p.y || p.y + p.h < rect.y)
    );
    if (overlaps()) {
      // nudge below the dot
      lx = l.px;
      anchor = "middle";
      ly = l.py + 12;
      rect = { x: lx - approxW / 2, y: ly - 10, w: approxW, h: LINE_H * 2 };
    }
    placed.push(rect);
    out.push({ lx, ly, anchor });
  }
  return out;
}
