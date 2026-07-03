import type { PaletteType } from "@/lib/palate";
import type { ResolvedLandmark } from "@/hooks/use-landmarks";

export type LovedPoint = {
  key: string;         // cuveeKey
  bottleId?: string;   // any representative bottle id in the cuvée
  axBody: number;      // 0..1 (light → bold)
  axFruit: number;     // 0..1 (fruit-forward → earthy / mineral-savory)
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
const MAX_LANDMARKS = 5;

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function coordFor(axBody: number, axFruit: number) {
  return { x: clamp01(axBody), y: clamp01(axFruit) };
}
function toPx(u: { x: number; y: number }) {
  // y increases upward in data (fruit-forward at 0 → bottom, earthy at 1 → top)
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

/** Pick up to `max` landmarks: one per quadrant first, then greedy furthest-from-picked. */
function pickSpread<T extends { x: number; y: number }>(items: T[], max: number): T[] {
  if (items.length <= max) return items.slice();
  const quadOf = (p: T) => (p.x < 0.5 ? 0 : 1) + (p.y < 0.5 ? 0 : 2);
  const picked: T[] = [];
  const usedQuads = new Set<number>();
  for (const it of items) {
    const q = quadOf(it);
    if (!usedQuads.has(q)) {
      picked.push(it);
      usedQuads.add(q);
      if (picked.length >= max) return picked;
    }
  }
  const remaining = items.filter((it) => !picked.includes(it));
  while (picked.length < max && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const minD = Math.min(...picked.map((p) => dist(cand, p)));
      if (minD > bestScore) { bestScore = minD; bestIdx = i; }
    }
    picked.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return picked;
}

const isDebugHost =
  typeof window !== "undefined" &&
  (import.meta.env.DEV ||
    /(?:-preview|lovable\.app|localhost)/.test(window.location.hostname));

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

  const lovedKeys = new Set(loved.map((l) => l.key));
  const lovedBottleIds = new Set(loved.map((l) => l.bottleId).filter(Boolean) as string[]);

  // All landmarks first, positioned in data space
  const lmAll = landmarks.map((l) => {
    const isLoved =
      lovedKeys.has(l.cuveeKey) || (!!l.bottleId && lovedBottleIds.has(l.bottleId));
    const c = coordFor(l.axBody, l.axFruit);
    return { ...l, ...c, isLoved };
  });
  // Pick spread-out set (loved landmarks kept preferentially by putting them first)
  const orderedForPick = [...lmAll].sort((a, b) => Number(b.isLoved) - Number(a.isLoved));
  const lmPicked = pickSpread(orderedForPick, MAX_LANDMARKS);
  const lmData = lmPicked.map((l) => ({ ...l, ...toPx({ x: l.x, y: l.y }) }));

  // Dedupe loved dots: skip any landmark match (picked or not, so we don't stack)
  const landmarkKeys = new Set(landmarks.map((l) => l.cuveeKey));
  const landmarkBottleIds = new Set(
    landmarks.map((l) => l.bottleId).filter(Boolean) as string[]
  );
  const lovedForDots = loved.filter(
    (l) => !landmarkKeys.has(l.key) && !(l.bottleId && landmarkBottleIds.has(l.bottleId))
  );
  const lovedCoords = lovedForDots.map((p) => coordFor(p.axBody, p.axFruit));

  // Cluster ALL loved points
  const allLovedCoords = loved.map((p) => coordFor(p.axBody, p.axFruit));
  const clusters = allLovedCoords.length
    ? singleLinkage(allLovedCoords, CLUSTER_THRESHOLD)
        .sort((a, b) => b.size - a.size)
        .slice(0, MAX_RINGS)
    : [];

  // Precompute ring geometry + "You" label rect (only for largest ring)
  const ringGeom = clusters.map((cl, i) => {
    const p = toPx(cl.center);
    const rNorm = Math.max(0.1, Math.min(0.2, 0.1 + cl.spread * 0.9));
    const r = rNorm * PLOT_W;
    const labeled = i === 0;
    const w = 28, h = 14;
    const labelRect = labeled ? { x: p.px - w / 2, y: p.py - r - 4 - h, w, h } : null;
    return { p, r, labeled, labelRect };
  });
  const ringLabelRects = ringGeom.map((g) => g.labelRect).filter(Boolean) as Rect[];

  const labelPositions = placeLabels(lmData, ringLabelRects);

  return (
    <div className="w-full max-w-[420px] mx-auto">
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        role="img"
        aria-label="Taste map"
        className="block w-full h-auto"
      >
        <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} rx={10}
          fill="var(--color-card)" stroke="var(--color-border)" strokeWidth={1} fillOpacity={0.4} />
        <line x1={PAD_L + PLOT_W / 2} y1={PAD_T} x2={PAD_L + PLOT_W / 2} y2={PAD_T + PLOT_H}
          stroke="var(--color-border)" strokeDasharray="3 5" strokeOpacity={0.5} />
        <line x1={PAD_L} y1={PAD_T + PLOT_H / 2} x2={PAD_L + PLOT_W} y2={PAD_T + PLOT_H / 2}
          stroke="var(--color-border)" strokeDasharray="3 5" strokeOpacity={0.5} />

        <text x={PAD_L + 8} y={PAD_T + 14} fontSize="11" fontStyle="italic"
          fill="var(--color-muted-foreground)">{corners.tl}</text>
        <text x={PAD_L + PLOT_W - 8} y={PAD_T + 14} fontSize="11" fontStyle="italic"
          textAnchor="end" fill="var(--color-muted-foreground)">{corners.tr}</text>
        <text x={PAD_L + 8} y={PAD_T + PLOT_H - 8} fontSize="11" fontStyle="italic"
          fill="var(--color-muted-foreground)">{corners.bl}</text>
        <text x={PAD_L + PLOT_W - 8} y={PAD_T + PLOT_H - 8} fontSize="11" fontStyle="italic"
          textAnchor="end" fill="var(--color-muted-foreground)">{corners.br}</text>

        <text x={PAD_L + PLOT_W / 2} y={VB - 12} textAnchor="middle" fontSize="12"
          fill="var(--color-muted-foreground)">{corners.xCap}</text>
        <text x={0} y={0}
          transform={`translate(14 ${PAD_T + PLOT_H / 2}) rotate(-90)`}
          textAnchor="middle" fontSize="12"
          fill="var(--color-muted-foreground)">{corners.yCap}</text>

        {/* Landmark dots + labels */}
        {lmData.map((l, i) => {
          const lp = labelPositions[i];
          const dotColor = l.isLoved ? "var(--color-primary)" : "var(--color-muted-foreground)";
          const dotOpacity = l.isLoved ? 1 : 0.6;
          const nameColor = l.isLoved ? "var(--color-primary)" : "var(--color-foreground)";
          return (
            <g key={l.label}>
              <circle cx={l.px} cy={l.py} r={l.isLoved ? 5 : 4}
                fill={dotColor} opacity={dotOpacity} />
              {lp && (
                <>
                  <text x={lp.lx} y={lp.ly} textAnchor={lp.anchor} fontSize="12"
                    fill={nameColor} fontWeight={l.isLoved ? 600 : 500}>
                    {l.label}
                  </text>
                  {lp.showSub && (
                    <text x={lp.lx} y={lp.ly + 12} textAnchor={lp.anchor} fontSize="11"
                      fill="var(--color-muted-foreground)">
                      {l.sub}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}

        {/* Loved dots (non-landmark) */}
        {lovedCoords.map((c, i) => {
          const p = toPx(c);
          return (
            <circle key={i} cx={p.px} cy={p.py} r={4}
              fill="var(--color-primary)" opacity={0.9} />
          );
        })}

        {/* Cluster rings — only the largest is labeled */}
        {ringGeom.map((g, i) => (
          <g key={i}>
            <circle cx={g.p.px} cy={g.p.py} r={g.r}
              fill="none"
              stroke="var(--color-primary)"
              strokeOpacity={0.2}
              strokeDasharray="3 6"
              strokeWidth={1.25} />
            {g.labeled && (
              <text x={g.p.px} y={g.p.py - g.r - 4}
                textAnchor="middle" fontSize="12" fontWeight={600}
                fill="var(--color-primary)">
                You
              </text>
            )}
          </g>
        ))}

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
                  ax_body={l.debug.axBody.toFixed(2)} ax_fruit_char={l.debug.axFruit.toFixed(2)}
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

type LabelPos = { lx: number; ly: number; anchor: "start" | "end" | "middle"; showSub: boolean } | null;
type Rect = { x: number; y: number; w: number; h: number };

const LABEL_H1 = 14; // single-line
const LABEL_H2 = 28; // two lines
const GAP = 6;

function rectFor(
  px: number,
  py: number,
  approxW: number,
  side: "right" | "left" | "above" | "below",
  h: number,
): { lx: number; ly: number; anchor: "start" | "end" | "middle"; rect: Rect } {
  if (side === "right") {
    const lx = px + GAP, ly = py - 2;
    return { lx, ly, anchor: "start", rect: { x: lx, y: ly - 10, w: approxW, h } };
  }
  if (side === "left") {
    const lx = px - GAP, ly = py - 2;
    return { lx, ly, anchor: "end", rect: { x: lx - approxW, y: ly - 10, w: approxW, h } };
  }
  if (side === "above") {
    const lx = px, ly = py - GAP - (h - 12);
    return { lx, ly, anchor: "middle", rect: { x: lx - approxW / 2, y: ly - 10, w: approxW, h } };
  }
  const lx = px, ly = py + GAP + 10;
  return { lx, ly, anchor: "middle", rect: { x: lx - approxW / 2, y: ly - 10, w: approxW, h } };
}

function overlapsAny(rect: Rect, others: Rect[]): boolean {
  return others.some(
    (p) => !(rect.x + rect.w < p.x || p.x + p.w < rect.x || rect.y + rect.h < p.y || p.y + p.h < rect.y)
  );
}
function insidePlot(rect: Rect): boolean {
  return rect.x >= PAD_L - 2 && rect.x + rect.w <= PAD_L + PLOT_W + 2
    && rect.y >= PAD_T - 2 && rect.y + rect.h <= PAD_T + PLOT_H + 2;
}

function placeLabels(
  lm: { px: number; py: number; label: string }[],
  obstacles: Rect[] = [],
): LabelPos[] {
  const placed: Rect[] = [...obstacles];
  const out: LabelPos[] = [];
  const SIDES: ("right" | "left" | "above" | "below")[] = ["right", "left", "above", "below"];

  for (const l of lm) {
    const approxW = Math.max(60, l.label.length * 6.5);
    const preferRight = l.px < PAD_L + PLOT_W * 0.6;
    const order = preferRight ? SIDES : (["left", "right", "above", "below"] as const);

    let chosen: { lx: number; ly: number; anchor: "start" | "end" | "middle"; rect: Rect } | null = null;
    let showSub = true;

    // First pass: full two-line label
    for (const side of order) {
      const cand = rectFor(l.px, l.py, approxW, side, LABEL_H2);
      if (insidePlot(cand.rect) && !overlapsAny(cand.rect, placed)) {
        chosen = cand;
        break;
      }
    }
    // Second pass: label only (drop sublabel)
    if (!chosen) {
      showSub = false;
      for (const side of order) {
        const cand = rectFor(l.px, l.py, approxW, side, LABEL_H1);
        if (insidePlot(cand.rect) && !overlapsAny(cand.rect, placed)) {
          chosen = cand;
          break;
        }
      }
    }

    if (!chosen) {
      out.push(null); // drop label entirely, dot remains
      continue;
    }
    placed.push(chosen.rect);
    out.push({ lx: chosen.lx, ly: chosen.ly, anchor: chosen.anchor, showSub });
  }
  return out;
}
