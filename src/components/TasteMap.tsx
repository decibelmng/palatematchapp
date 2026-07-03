import type { PaletteType } from "@/lib/palate";
import type { FpKey } from "@/lib/recommender";
import type { ResolvedLandmark } from "@/hooks/use-landmarks";

export type LovedPoint = {
  key: string;       // cuveeKey
  bottleId?: string; // any representative bottle id in the cuvée
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

const CLUSTER_THRESHOLD = 0.22;
const MAX_RINGS = 4;

function coordFor(type: PaletteType, fp: Record<FpKey, number>) {
  const x = type === "red" ? (fp.body + fp.tannin) / 2 : (fp.body + fp.oak) / 2;
  const y = fp.savory;
  return { x: clamp01(x), y: clamp01(y) };
}
function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function toPx(u: { x: number; y: number }) {
  return { px: PAD_L + u.x * PLOT_W, py: PAD_T + (1 - u.y) * PLOT_H };
}
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Single-linkage clustering: points within `thr` (transitively) form a cluster. */
function singleLinkage(pts: { x: number; y: number }[], thr: number) {
  const n = pts.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (dist(pts[i], pts[j]) <= thr) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }
  return Array.from(groups.values()).map((idxs) => {
    const gp = idxs.map((i) => pts[i]);
    const cx = gp.reduce((s, p) => s + p.x, 0) / gp.length;
    const cy = gp.reduce((s, p) => s + p.y, 0) / gp.length;
    const center = { x: cx, y: cy };
    const spread = gp.length === 1 ? 0 : gp.reduce((s, p) => s + dist(p, center), 0) / gp.length;
    return { center, spread, size: gp.length };
  });
}

const isDebugHost =
  typeof window !== "undefined" &&
  (import.meta.env.DEV ||
    /(?:-preview|lovable\.app|localhost)/.test(window.location.hostname));

export function TasteMap({ type, landmarks, loved, showOverlay, overlayText }: Props) {
  const corners = type === "red"
    ? {
        tl: "Delicate & savory", tr: "Powerful & savory",
        bl: "Delicate & fruity", br: "Powerful & fruity",
        xCap: "Delicate → Powerful", yCap: "Fruit → Savory",
      }
    : {
        tl: "Crisp & mineral", tr: "Rich & mineral",
        bl: "Crisp & fruity", br: "Rich & fruity",
        xCap: "Crisp → Rich", yCap: "Fruit → Mineral",
      };

  // Dedupe: landmark that matches a loved wine renders as one primary dot with its label.
  const lovedKeys = new Set(loved.map((l) => l.key));
  const lovedBottleIds = new Set(loved.map((l) => l.bottleId).filter(Boolean) as string[]);

  const lmData = landmarks.map((l) => {
    const isLoved =
      lovedKeys.has(l.cuveeKey) || (!!l.bottleId && lovedBottleIds.has(l.bottleId));
    const c = coordFor(type, l.fp);
    const p = toPx(c);
    return { ...l, ...c, ...p, isLoved };
  });

  // Loved coords EXCLUDING those that match a landmark (avoid stacked dots)
  const landmarkKeys = new Set(landmarks.map((l) => l.cuveeKey));
  const landmarkBottleIds = new Set(
    landmarks.map((l) => l.bottleId).filter(Boolean) as string[]
  );
  const lovedForDots = loved.filter(
    (l) => !landmarkKeys.has(l.key) && !(l.bottleId && landmarkBottleIds.has(l.bottleId))
  );
  const lovedCoords = lovedForDots.map((p) => coordFor(type, p.fp));

  // Cluster ALL loved points so rings reflect true palate modes
  const allLovedCoords = loved.map((p) => coordFor(type, p.fp));
  const clusters = allLovedCoords.length
    ? singleLinkage(allLovedCoords, CLUSTER_THRESHOLD)
        .sort((a, b) => b.size - a.size)
        .slice(0, MAX_RINGS)
    : [];

  // Precompute "You" ring label rects so landmark placement can dodge them
  const ringLabelRects = clusters.map((cl) => {
    const p = toPx(cl.center);
    const rNorm = Math.max(0.1, Math.min(0.2, 0.1 + cl.spread * 0.9));
    const r = rNorm * PLOT_W;
    const w = 28, h = 14;
    return { x: p.px - w / 2, y: p.py - r - 4 - h, w, h };
  });

  const labelPositions = placeLabels(lmData, ringLabelRects);

  return (
    <div className="w-full max-w-[420px] mx-auto">
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        role="img"
        aria-label="Taste map"
        className="block w-full h-auto"
      >
        {/* Plot */}
        <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} rx={10}
          fill="var(--color-card)" stroke="var(--color-border)" strokeWidth={1} fillOpacity={0.4} />
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
        <text x={0} y={0}
          transform={`translate(14 ${PAD_T + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle" fontSize="12"
          fill="var(--color-muted-foreground)">{corners.yCap}</text>

        {/* Landmark dots (loved landmarks are primary-colored, keep label) */}
        {lmData.map((l, i) => {
          const lp = labelPositions[i];
          const dotColor = l.isLoved ? "var(--color-primary)" : "var(--color-muted-foreground)";
          const dotOpacity = l.isLoved ? 1 : 0.6;
          const nameColor = l.isLoved ? "var(--color-primary)" : "var(--color-foreground)";
          return (
            <g key={l.label}>
              <circle cx={l.px} cy={l.py} r={l.isLoved ? 5 : 4}
                fill={dotColor} opacity={dotOpacity} />
              <text x={lp.lx} y={lp.ly} textAnchor={lp.anchor} fontSize="12"
                fill={nameColor} fontWeight={l.isLoved ? 600 : 500}>
                {l.label}
              </text>
              <text x={lp.lx} y={lp.ly + 12} textAnchor={lp.anchor} fontSize="11"
                fill="var(--color-muted-foreground)">
                {l.sub}
              </text>
            </g>
          );
        })}

        {/* User loved dots (non-landmark), one per wine */}
        {lovedCoords.map((c, i) => {
          const p = toPx(c);
          return (
            <circle key={i} cx={p.px} cy={p.py} r={4}
              fill="var(--color-primary)" opacity={0.9} />
          );
        })}

        {/* Cluster rings */}
        {clusters.map((cl, i) => {
          const p = toPx(cl.center);
          const rNorm = Math.max(0.1, Math.min(0.2, 0.1 + cl.spread * 0.9));
          const r = rNorm * PLOT_W;
          return (
            <g key={i}>
              <circle cx={p.px} cy={p.py} r={r}
                fill="none"
                stroke="var(--color-primary)"
                strokeOpacity={0.3}
                strokeDasharray="4 4"
                strokeWidth={1.5} />
              <text x={p.px} y={p.py - r - 4}
                textAnchor="middle" fontSize="12" fontWeight={600}
                fill="var(--color-primary)">
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

      {isDebugHost && landmarks.length > 0 && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Landmark debug</summary>
          <ul className="mt-2 space-y-1 font-mono">
            {landmarks.map((l) => (
              <li key={l.label}>
                <div>
                  <span className="text-foreground">{l.label}</span>{" "}
                  <span>← "{l.debug.query}"</span>
                </div>
                <div>
                  matched: {l.debug.matchedProducer ?? "?"} — {l.debug.matchedName}
                </div>
                <div>
                  fp:{" "}
                  {(Object.keys(l.debug.fp) as (keyof typeof l.debug.fp)[])
                    .map((k) => `${k}=${l.debug.fp[k].toFixed(2)}`)
                    .join(" ")}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type LabelPos = { lx: number; ly: number; anchor: "start" | "end" | "middle" };
type Rect = { x: number; y: number; w: number; h: number };

function rectFor(
  px: number,
  py: number,
  approxW: number,
  side: "right" | "left" | "below",
): { lx: number; ly: number; anchor: LabelPos["anchor"]; rect: Rect } {
  const H = 28; // two lines
  if (side === "right") {
    const lx = px + 6, ly = py - 2;
    return { lx, ly, anchor: "start", rect: { x: lx, y: ly - 10, w: approxW, h: H } };
  }
  if (side === "left") {
    const lx = px - 6, ly = py - 2;
    return { lx, ly, anchor: "end", rect: { x: lx - approxW, y: ly - 10, w: approxW, h: H } };
  }
  const lx = px, ly = py + 14;
  return { lx, ly, anchor: "middle", rect: { x: lx - approxW / 2, y: ly - 10, w: approxW, h: H } };
}

function overlapsAny(rect: Rect, others: Rect[]): boolean {
  return others.some(
    (p) => !(rect.x + rect.w < p.x || p.x + p.w < rect.x || rect.y + rect.h < p.y || p.y + p.h < rect.y)
  );
}

function placeLabels(
  lm: { px: number; py: number; label: string }[],
  obstacles: Rect[] = [],
): LabelPos[] {
  const placed: Rect[] = [...obstacles];
  const out: LabelPos[] = [];
  for (const l of lm) {
    const approxW = Math.max(60, l.label.length * 6.5);
    const preferRight = l.px < PAD_L + PLOT_W * 0.75;
    const order: ("right" | "left" | "below")[] = preferRight
      ? ["right", "left", "below"]
      : ["left", "right", "below"];
    let chosen = rectFor(l.px, l.py, approxW, order[0]);
    for (const side of order) {
      const cand = rectFor(l.px, l.py, approxW, side);
      if (!overlapsAny(cand.rect, placed)) { chosen = cand; break; }
      chosen = cand; // fall through with last tried
    }
    placed.push(chosen.rect);
    out.push({ lx: chosen.lx, ly: chosen.ly, anchor: chosen.anchor });
  }
  return out;
}
