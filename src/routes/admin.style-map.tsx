// /admin/style-map — internal Catalog QA diagnostic.
//
// AUDIENCE: us. Desktop-first. This is a debugging instrument — its job is
// to make bad fingerprints visible at a glance. NO changes to any engine
// scoring path: recommender.ts, lanes.ts, and style-neighbors.ts are
// untouched. Region positions here are derived from fingerprints for
// display only (Invariant 8).
import { createFileRoute } from "@tanstack/react-router";
import { AuthGate } from "@/components/AuthGate";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  adminStyleMapFetch,
  adminStyleMapNote,
  type StyleMapRow,
} from "@/lib/admin-style-map.functions";
import { RAX, axisApplies, type FpKey, type WineType } from "@/lib/recommender";

export const Route = createFileRoute("/admin/style-map")({
  ssr: false,
  head: () => ({ meta: [{ title: "Style Map · Admin" }] }),
  component: () => <AuthGate><StyleMap /></AuthGate>,
});

// ────────────────────────────────────────────────────────────
// Source normalization
// ────────────────────────────────────────────────────────────
type SourceBucket =
  | "base-llm" | "kaggle" | "re-fingerprinted" | "user-added"
  | "on-demand" | "tasting-derived" | "other";

function sourceBucket(s: string | null | undefined): SourceBucket {
  if (!s) return "other";
  if (s.includes("tasting-derived")) return "tasting-derived";
  if (s.includes("refingerprinted") || s.includes("re-fingerprint")) return "re-fingerprinted";
  if (s.startsWith("on-demand")) return "on-demand";
  if (s.includes("user-added")) return "user-added";
  if (s.includes("Kaggle")) return "kaggle";
  if (s.includes("LLM-derived")) return "base-llm";
  return "other";
}

const SOURCE_COLORS: Record<SourceBucket, string> = {
  "base-llm":        "#4b7bec",
  "kaggle":          "#20bf6b",
  "re-fingerprinted":"#f7b731",
  "user-added":      "#a55eea",
  "on-demand":       "#eb3b5a",
  "tasting-derived": "#ff6f00",
  "other":           "#8395a7",
};
const SOURCE_ORDER: SourceBucket[] = [
  "base-llm","kaggle","re-fingerprinted","user-added","on-demand","tasting-derived","other",
];

// ────────────────────────────────────────────────────────────
// Known-answer & control-group presets
// ────────────────────────────────────────────────────────────
type PriorBand = "high" | "mid" | "low";
type Prior = Partial<Record<FpKey, PriorBand>>;
type PresetDef = {
  label: string;
  type: WineType;
  matcher: (b: StyleMapRow) => boolean;
  prior: Prior;
  note?: string;
};

const bandOf = (v: number): PriorBand => (v > 0.6 ? "high" : v < 0.4 ? "low" : "mid");

const KNOWN_ANSWERS: PresetDef[] = [
  { label: "Barolo",         type: "red",   matcher: b => b.region === "Barolo",
    prior: { tannin: "high", acid: "high", savory: "high", body: "mid" } },
  { label: "Barbaresco",     type: "red",   matcher: b => b.region === "Barbaresco",
    prior: { tannin: "high", acid: "high", savory: "high", body: "mid" } },
  { label: "Napa Cabernet",  type: "red",
    matcher: b => (b.region ?? "").toLowerCase().includes("napa") &&
                  (b.grape ?? "").toLowerCase().includes("cabernet"),
    prior: { body: "high", oak: "high", ripe: "high", tannin: "high" } },
  { label: "Vosne-Romanée / Chambolle", type: "red",
    matcher: b => {
      const r = (b.region ?? "").toLowerCase();
      return r.includes("vosne") || r.includes("chambolle");
    },
    prior: { body: "low", tannin: "low", savory: "high", acid: "high" } },
  { label: "Chablis",        type: "white", matcher: b => b.region === "Chablis",
    prior: { acid: "high", savory: "high", oak: "low", body: "low" } },
  { label: "Sancerre",       type: "white", matcher: b => b.region === "Sancerre",
    prior: { acid: "high", savory: "high", oak: "low" } },
  { label: "Mosel Riesling", type: "white",
    matcher: b => b.region === "Mosel" && (b.grape ?? "").toLowerCase().includes("riesling"),
    prior: { acid: "high", body: "low", oak: "low" } },
  { label: "Barossa Shiraz", type: "red",
    matcher: b => (b.region ?? "").toLowerCase().includes("barossa") &&
                  /shiraz|syrah/.test((b.grape ?? "").toLowerCase()),
    prior: { body: "high", ripe: "high", oak: "high" } },
  { label: "Beaujolais crus", type: "red",
    matcher: b => (b.region ?? "").toLowerCase().includes("beaujolais") ||
                  ((b.grape ?? "").toLowerCase() === "gamay"),
    prior: { body: "low", tannin: "low", ripe: "high" } },
  { label: "Rioja",          type: "red",   matcher: b => b.region === "Rioja",
    prior: { oak: "high", savory: "high" }, note: "Gran Reserva subset not distinguishable in catalog" },
];

const CONTROL_GROUPS: PresetDef[] = [
  { label: "California",   type: "red", matcher: b => b.region === "California", prior: {} },
  { label: "Bordeaux",     type: "red", matcher: b => b.region === "Bordeaux",   prior: {} },
  { label: "Toscana",      type: "red", matcher: b => b.region === "Toscana",    prior: {} },
  { label: "Vin de France",type: "red", matcher: b => b.region === "Vin de France", prior: {} },
  { label: "Central Coast",type: "red", matcher: b => b.region === "Central Coast", prior: {} },
];

// ────────────────────────────────────────────────────────────
// Stats helpers
// ────────────────────────────────────────────────────────────
type AxisStats = { mean: number; variance: number };
type RegionStats = {
  region: string;
  count: number;
  centroid: Record<FpKey, number>;
  perAxisVar: Record<FpKey, number>;
  dispersionFull: number;   // sqrt(sum active Var)
  coherenceFull: number;    // dispersionFull / catalogDispersionFull
};

function activeAxes(t: WineType): FpKey[] {
  return RAX.filter((a) => axisApplies(a, t));
}

function meanAndVar(vals: number[]): AxisStats {
  if (vals.length === 0) return { mean: 0, variance: 0 };
  let s = 0; for (const v of vals) s += v;
  const m = s / vals.length;
  let ss = 0; for (const v of vals) ss += (v - m) * (v - m);
  return { mean: m, variance: ss / vals.length };
}

function computeCentroid(rows: StyleMapRow[], axes: FpKey[]): {
  centroid: Record<FpKey, number>;
  perAxisVar: Record<FpKey, number>;
} {
  const centroid = {} as Record<FpKey, number>;
  const perAxisVar = {} as Record<FpKey, number>;
  for (const a of RAX) { centroid[a] = 0; perAxisVar[a] = 0; }
  for (const a of axes) {
    const vals = rows.map((r) => r.fp[a]);
    const s = meanAndVar(vals);
    centroid[a] = s.mean;
    perAxisVar[a] = s.variance;
  }
  return { centroid, perAxisVar };
}

function dispersionFrom(perAxisVar: Record<FpKey, number>, axes: FpKey[]): number {
  let s = 0; for (const a of axes) s += perAxisVar[a];
  return Math.sqrt(s);
}

function euclid(a: Record<FpKey, number>, b: Record<FpKey, number>, axes: FpKey[]): number {
  let s = 0; for (const k of axes) { const d = a[k] - b[k]; s += d * d; }
  return Math.sqrt(s);
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

function StyleMap() {
  const fetchFn = useServerFn(adminStyleMapFetch);
  const noteFn = useServerFn(adminStyleMapNote);

  const [type, setType] = useState<WineType>("red");
  const [xAxis, setXAxis] = useState<FpKey>("body");
  const [yAxis, setYAxis] = useState<FpKey>("oak");
  const [enabledSources, setEnabledSources] = useState<Set<SourceBucket>>(
    () => new Set(SOURCE_ORDER),
  );
  const [regionQuery, setRegionQuery] = useState("");
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showKnown, setShowKnown] = useState(true);
  const [showControl, setShowControl] = useState(false);
  const [tableSort, setTableSort] = useState<{ key: "region"|"count"|"coherence"; dir: 1|-1 }>(
    { key: "coherence", dir: 1 },
  );

  const q = useQuery({
    queryKey: ["admin-style-map", type],
    queryFn: () => fetchFn({ data: { type } }),
    staleTime: 5 * 60_000,
  });

  const rows = (q.data ?? []) as StyleMapRow[];

  const axes = useMemo(() => activeAxes(type), [type]);

  // ensure current axis choices are valid for the type
  useEffect(() => {
    if (!axes.includes(xAxis)) setXAxis(axes[0]);
    if (!axes.includes(yAxis)) setYAxis(axes[1] ?? axes[0]);
  }, [axes, xAxis, yAxis]);

  // Catalog dispersion (per active axes, full space).
  const catalog = useMemo(() => {
    if (rows.length === 0) return null;
    const { centroid, perAxisVar } = computeCentroid(rows, axes);
    const dispersion = dispersionFrom(perAxisVar, axes);
    // 2D catalog dispersion on the chosen axis pair
    const dispersion2D = Math.sqrt((perAxisVar[xAxis] ?? 0) + (perAxisVar[yAxis] ?? 0));
    return { centroid, perAxisVar, dispersion, dispersion2D };
  }, [rows, axes, xAxis, yAxis]);

  // Region stats (regions with 30+ rows) — full space
  const regionStats = useMemo<RegionStats[]>(() => {
    if (!catalog) return [];
    const byRegion = new Map<string, StyleMapRow[]>();
    for (const r of rows) {
      if (!r.region) continue;
      const arr = byRegion.get(r.region);
      if (arr) arr.push(r); else byRegion.set(r.region, [r]);
    }
    const out: RegionStats[] = [];
    for (const [name, members] of byRegion) {
      if (members.length < 30) continue;
      const { centroid, perAxisVar } = computeCentroid(members, axes);
      const disp = dispersionFrom(perAxisVar, axes);
      out.push({
        region: name, count: members.length,
        centroid, perAxisVar,
        dispersionFull: disp,
        coherenceFull: disp / catalog.dispersion,
      });
    }
    return out;
  }, [rows, axes, catalog]);

  // Region 2D coherence per current axis pair (recomputed cheaply)
  const region2D = useMemo(() => {
    if (!catalog) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const rs of regionStats) {
      const disp2D = Math.sqrt((rs.perAxisVar[xAxis] ?? 0) + (rs.perAxisVar[yAxis] ?? 0));
      m.set(rs.region, disp2D / (catalog.dispersion2D || 1));
    }
    return m;
  }, [regionStats, catalog, xAxis, yAxis]);

  // Best axis pair: which pair maximizes mean pairwise 2D centroid distance
  // between the top-15 regions by count, normalized by 2D catalog dispersion.
  const bestPairs = useMemo(() => {
    if (regionStats.length < 4) return [] as Array<{ x: FpKey; y: FpKey; score: number }>;
    const topN = [...regionStats].sort((a, b) => b.count - a.count).slice(0, 15);
    const results: Array<{ x: FpKey; y: FpKey; score: number }> = [];
    for (let i = 0; i < axes.length; i++) {
      for (let j = i + 1; j < axes.length; j++) {
        const ax = axes[i], ay = axes[j];
        const catDisp = catalog ? Math.sqrt(catalog.perAxisVar[ax] + catalog.perAxisVar[ay]) : 1;
        let sum = 0, pairs = 0;
        for (let a = 0; a < topN.length; a++) {
          for (let b = a + 1; b < topN.length; b++) {
            const dx = topN[a].centroid[ax] - topN[b].centroid[ax];
            const dy = topN[a].centroid[ay] - topN[b].centroid[ay];
            sum += Math.sqrt(dx*dx + dy*dy);
            pairs++;
          }
        }
        results.push({ x: ax, y: ay, score: (sum / (pairs || 1)) / (catDisp || 1) });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }, [axes, regionStats, catalog]);

  // Presets: verdict per known-answer / control-group.
  const presetResult = useMemo(() => {
    const evaluate = (defs: PresetDef[]) =>
      defs.filter((d) => d.type === type).map((d) => {
        const members = rows.filter(d.matcher);
        if (members.length === 0) {
          return { def: d, count: 0, centroid: null, verdicts: [] as Array<{axis: FpKey; want: PriorBand; got: PriorBand; value: number; ok: boolean}>, dispersionFull: 0, coherenceFull: 0, coherence2D: 0 };
        }
        const { centroid, perAxisVar } = computeCentroid(members, axes);
        const dispersionFull = dispersionFrom(perAxisVar, axes);
        const coherenceFull = catalog ? dispersionFull / catalog.dispersion : 0;
        const dispersion2D = Math.sqrt((perAxisVar[xAxis] ?? 0) + (perAxisVar[yAxis] ?? 0));
        const coherence2D = catalog ? dispersion2D / (catalog.dispersion2D || 1) : 0;
        const verdicts = (Object.entries(d.prior) as Array<[FpKey, PriorBand]>).map(
          ([axis, want]) => {
            const value = centroid[axis];
            const got = bandOf(value);
            return { axis, want, got, value, ok: got === want };
          },
        );
        return { def: d, count: members.length, centroid, verdicts, dispersionFull, coherenceFull, coherence2D };
      });
    return {
      known: evaluate(KNOWN_ANSWERS),
      control: evaluate(CONTROL_GROUPS),
    };
  }, [rows, axes, catalog, type, xAxis, yAxis]);

  // Barolo vs Napa Cabernet centroid distance (reds only) — full active space.
  const baroloNapa = useMemo(() => {
    if (type !== "red" || !catalog) return null;
    const barolo = rows.filter((b) => b.region === "Barolo");
    const napaCab = rows.filter((b) =>
      (b.region ?? "").toLowerCase().includes("napa") &&
      (b.grape ?? "").toLowerCase().includes("cabernet"),
    );
    if (barolo.length === 0 || napaCab.length === 0) return null;
    const bc = computeCentroid(barolo, axes).centroid;
    const nc = computeCentroid(napaCab, axes).centroid;
    const dist = euclid(bc, nc, axes);
    return {
      baroloN: barolo.length, napaN: napaCab.length,
      dist, ratio: dist / catalog.dispersion,
    };
  }, [rows, axes, catalog, type]);

  // Filter set for canvas rendering: source toggles + region search + selection.
  const searchLower = regionQuery.trim().toLowerCase();
  const filteredIdx = useMemo(() => {
    const idxs: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      const b = rows[i];
      const bucket = sourceBucket(b.source);
      if (!enabledSources.has(bucket)) continue;
      if (searchLower) {
        const r = (b.region ?? "").toLowerCase();
        if (!r.includes(searchLower)) continue;
      }
      if (selectedRegion && b.region !== selectedRegion) continue;
      idxs.push(i);
    }
    return idxs;
  }, [rows, enabledSources, searchLower, selectedRegion]);

  // Canvas rendering
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const PLOT_W = 820, PLOT_H = 640;
  const PAD = 40;
  const toPxX = (v: number) => PAD + v * (PLOT_W - 2 * PAD);
  const toPxY = (v: number) => PLOT_H - PAD - v * (PLOT_H - 2 * PAD);
  const fromPxX = (px: number) => (px - PAD) / (PLOT_W - 2 * PAD);
  const fromPxY = (py: number) => (PLOT_H - PAD - py) / (PLOT_H - 2 * PAD);

  const overlayRegions = useMemo(() => {
    // Pick presets to overlay based on toggles + explicit selection.
    const shown = new Set<string>();
    if (showKnown) KNOWN_ANSWERS.filter((d) => d.type === type).forEach((d) => shown.add(d.label));
    if (showControl) CONTROL_GROUPS.filter((d) => d.type === type).forEach((d) => shown.add(d.label));
    // Map preset label → members centroid + 2D σ
    const items: Array<{
      label: string; cx: number; cy: number; sx: number; sy: number; count: number;
      isControl: boolean;
    }> = [];
    const push = (defs: PresetDef[], isControl: boolean) => {
      for (const d of defs) {
        if (d.type !== type) continue;
        if (!shown.has(d.label)) continue;
        const members = rows.filter(d.matcher);
        if (members.length < 30) continue;
        const { centroid, perAxisVar } = computeCentroid(members, axes);
        items.push({
          label: d.label,
          cx: centroid[xAxis], cy: centroid[yAxis],
          sx: Math.sqrt(perAxisVar[xAxis] ?? 0),
          sy: Math.sqrt(perAxisVar[yAxis] ?? 0),
          count: members.length,
          isControl,
        });
      }
    };
    push(KNOWN_ANSWERS, false);
    push(CONTROL_GROUPS, true);
    return items;
  }, [rows, axes, xAxis, yAxis, type, showKnown, showControl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = PLOT_W * dpr;
    canvas.height = PLOT_H * dpr;
    canvas.style.width = PLOT_W + "px";
    canvas.style.height = PLOT_H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PLOT_W, PLOT_H);

    // Background grid
    ctx.strokeStyle = "hsl(var(--border) / 0.4)";
    ctx.lineWidth = 1;
    for (let t = 0; t <= 10; t++) {
      const gx = toPxX(t / 10), gy = toPxY(t / 10);
      ctx.beginPath(); ctx.moveTo(gx, PAD); ctx.lineTo(gx, PLOT_H - PAD); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(PLOT_W - PAD, gy); ctx.stroke();
    }
    // Axis labels
    ctx.fillStyle = "hsl(var(--foreground))";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(xAxis, PLOT_W / 2, PLOT_H - 8);
    ctx.save();
    ctx.translate(12, PLOT_H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(yAxis, 0, 0);
    ctx.restore();
    // Tick labels 0 and 1
    ctx.textAlign = "left"; ctx.fillText("0", PAD - 6, PLOT_H - PAD + 14);
    ctx.textAlign = "right"; ctx.fillText("1", PLOT_W - PAD + 4, PLOT_H - PAD + 14);
    ctx.textAlign = "right"; ctx.fillText("0", PAD - 6, PLOT_H - PAD + 4);
    ctx.fillText("1", PAD - 6, PAD + 4);

    // Points — dim non-filtered when region is selected or search set
    const alphaBase = 0.55;
    const alphaDim = 0.06;
    const isFocused = selectedRegion !== null || searchLower.length > 0;
    const filterSet = new Set(filteredIdx);
    // Draw dim first
    if (isFocused) {
      ctx.globalAlpha = alphaDim;
      for (let i = 0; i < rows.length; i++) {
        if (filterSet.has(i)) continue;
        const b = rows[i];
        const bucket = sourceBucket(b.source);
        if (!enabledSources.has(bucket)) continue;
        ctx.fillStyle = SOURCE_COLORS[bucket];
        ctx.beginPath();
        ctx.arc(toPxX(b.fp[xAxis]), toPxY(b.fp[yAxis]), 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Draw focused / all
    ctx.globalAlpha = alphaBase;
    for (const i of filteredIdx) {
      const b = rows[i];
      const bucket = sourceBucket(b.source);
      ctx.fillStyle = SOURCE_COLORS[bucket];
      ctx.beginPath();
      ctx.arc(toPxX(b.fp[xAxis]), toPxY(b.fp[yAxis]), 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Region overlays
    for (const r of overlayRegions) {
      const cx = toPxX(r.cx), cy = toPxY(r.cy);
      const rx = r.sx * (PLOT_W - 2 * PAD);
      const ry = r.sy * (PLOT_H - 2 * PAD);
      ctx.strokeStyle = r.isControl ? "hsl(0 60% 55% / 0.9)" : "hsl(45 90% 55% / 0.95)";
      ctx.lineWidth = r.isControl ? 1.5 : 2;
      ctx.setLineDash(r.isControl ? [5, 3] : []);
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rx, 2), Math.max(ry, 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Center dot
      ctx.fillStyle = r.isControl ? "hsl(0 70% 55%)" : "hsl(45 90% 55%)";
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      // Label with coherence ratio
      const coh = region2D.get(r.label);
      const cohText = coh !== undefined ? ` (${coh.toFixed(2)})` : "";
      ctx.fillStyle = "hsl(var(--foreground))";
      ctx.font = "11px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`${r.label}${cohText}`, cx + 5, cy - 4);
    }

    // Highlight selected point
    if (selectedId) {
      const b = rows.find((r) => r.id === selectedId);
      if (b) {
        ctx.strokeStyle = "hsl(var(--foreground))";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(toPxX(b.fp[xAxis]), toPxY(b.fp[yAxis]), 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }, [rows, filteredIdx, xAxis, yAxis, overlayRegions, region2D, enabledSources, selectedRegion, searchLower, selectedId]);

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const dataX = fromPxX(px), dataY = fromPxY(py);
    // Nearest point in data space (within pixel radius ~ 8px worth of data)
    const rx = 8 / (PLOT_W - 2 * PAD);
    const ry = 8 / (PLOT_H - 2 * PAD);
    let best: { id: string; d: number } | null = null;
    for (const b of rows) {
      const dx = (b.fp[xAxis] - dataX) / rx;
      const dy = (b.fp[yAxis] - dataY) / ry;
      const d = dx * dx + dy * dy;
      if (d < 1 && (!best || d < best.d)) best = { id: b.id, d };
    }
    setSelectedId(best?.id ?? null);
  };

  // Selected bottle detail + tasting note
  const noteQ = useQuery({
    queryKey: ["admin-style-map-note", selectedId],
    queryFn: () => noteFn({ data: { id: selectedId! } }),
    enabled: !!selectedId,
    staleTime: 60_000,
  });
  const selectedBottle = selectedId ? rows.find((r) => r.id === selectedId) ?? null : null;

  // Region member list (nearest first — outliers at bottom flag defects)
  const regionMembers = useMemo(() => {
    if (!selectedRegion) return [];
    const rs = regionStats.find((r) => r.region === selectedRegion);
    if (!rs) return [];
    const members = rows.filter((r) => r.region === selectedRegion);
    return members
      .map((b) => ({ b, d: euclid(b.fp as any, rs.centroid, axes) }))
      .sort((a, b) => a.d - b.d);
  }, [selectedRegion, regionStats, rows, axes]);

  const err = q.error;
  const notAuthed = err && /Not authorized/i.test((err as Error).message);
  if (notAuthed) return <div className="p-8">Not found.</div>;

  const sortedRegionStats = useMemo(() => {
    const copy = [...regionStats];
    const dir = tableSort.dir;
    copy.sort((a, b) => {
      const k = tableSort.key;
      if (k === "region") return dir * a.region.localeCompare(b.region);
      if (k === "count") return dir * (b.count - a.count);
      return dir * (a.coherenceFull - b.coherenceFull);
    });
    return copy;
  }, [regionStats, tableSort]);

  return (
    <div className="pt-6 pb-24 space-y-6 max-w-[1400px]">
      <header className="space-y-1">
        <h1 className="font-serif text-2xl">Catalog QA — Style Map</h1>
        <p className="text-xs text-muted-foreground">
          Internal diagnostic. Region positions are derived from fingerprints for
          display only — no scoring path is affected (Invariant 8). Engine files
          <code className="mx-1">recommender.ts</code>,
          <code className="mx-1">lanes.ts</code>, and
          <code className="mx-1">style-neighbors.ts</code> unchanged by this feature.
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-end border border-border rounded-md p-3 bg-card">
        <div>
          <div className="text-meta text-muted-foreground mb-1">Type</div>
          <div className="flex gap-1">
            {(["red","white","rose","sparkling","dessert"] as WineType[]).map((t) => (
              <button key={t}
                onClick={() => { setType(t); setSelectedRegion(null); setSelectedId(null); }}
                className={`px-2 py-1 text-sm rounded border ${type===t ? "bg-primary text-primary-foreground border-primary" : "border-border"}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-meta text-muted-foreground mb-1">X axis</div>
          <select value={xAxis} onChange={(e) => setXAxis(e.target.value as FpKey)}
            className="bg-card border border-border rounded px-2 py-1 text-sm">
            {axes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <div className="text-meta text-muted-foreground mb-1">Y axis</div>
          <select value={yAxis} onChange={(e) => setYAxis(e.target.value as FpKey)}
            className="bg-card border border-border rounded px-2 py-1 text-sm">
            {axes.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div>
          <div className="text-meta text-muted-foreground mb-1">Region search</div>
          <input type="text" value={regionQuery}
            onChange={(e) => setRegionQuery(e.target.value)}
            placeholder="e.g. Barolo"
            className="bg-card border border-border rounded px-2 py-1 text-sm" />
        </div>

        <div>
          <div className="text-meta text-muted-foreground mb-1">Overlays</div>
          <label className="text-sm mr-3">
            <input type="checkbox" checked={showKnown} onChange={(e) => setShowKnown(e.target.checked)} className="mr-1" />
            Known-answer
          </label>
          <label className="text-sm">
            <input type="checkbox" checked={showControl} onChange={(e) => setShowControl(e.target.checked)} className="mr-1" />
            Control group
          </label>
        </div>

        <div className="ml-auto text-xs text-muted-foreground">
          {q.isLoading ? "loading catalog…" : `${rows.length.toLocaleString()} rows`}
        </div>
      </div>

      {/* Source legend */}
      <div className="flex flex-wrap gap-2 text-xs">
        {SOURCE_ORDER.map((s) => {
          const on = enabledSources.has(s);
          return (
            <button key={s}
              onClick={() => {
                const n = new Set(enabledSources);
                on ? n.delete(s) : n.add(s);
                setEnabledSources(n);
              }}
              className={`px-2 py-1 rounded border flex items-center gap-1 ${on ? "border-border" : "border-border opacity-40"}`}
              style={{ borderLeft: `4px solid ${SOURCE_COLORS[s]}` }}>
              <span>{s}</span>
            </button>
          );
        })}
      </div>

      {/* Plot + selection */}
      <div className="grid grid-cols-[820px_1fr] gap-4">
        <div className="border border-border rounded-md bg-card">
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            style={{ display: "block", cursor: "crosshair" }}
          />
        </div>

        <div className="space-y-3 text-sm min-w-0">
          {selectedBottle ? (
            <div className="border border-border rounded p-3 bg-card space-y-2">
              <div className="flex justify-between items-start">
                <div className="font-medium leading-tight">{selectedBottle.name}</div>
                <button onClick={() => setSelectedId(null)} className="text-xs text-muted-foreground">clear</button>
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedBottle.producer ?? "—"} · {selectedBottle.region ?? "—"} · {selectedBottle.vintage ?? "—"} · {selectedBottle.grape ?? "—"}
              </div>
              <div className="text-xs">source: <span className="text-muted-foreground">{selectedBottle.source ?? "—"}</span></div>
              <div className="grid grid-cols-4 gap-1 text-xs">
                {RAX.map((a) => (
                  <div key={a} className={axes.includes(a) ? "" : "opacity-40"}>
                    <span className="text-muted-foreground">{a}</span>{" "}
                    <span>{selectedBottle.fp[a].toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="text-xs">
                <div className="text-muted-foreground mb-1">tasting note</div>
                <div className="whitespace-pre-wrap">
                  {noteQ.isLoading ? "loading…" : (noteQ.data ?? <span className="text-muted-foreground">(none)</span>)}
                </div>
              </div>
            </div>
          ) : null}

          {selectedRegion ? (
            <div className="border border-border rounded p-3 bg-card space-y-2">
              <div className="flex justify-between items-center">
                <div className="font-medium">{selectedRegion} — {regionMembers.length} members</div>
                <button onClick={() => setSelectedRegion(null)} className="text-xs text-muted-foreground">clear</button>
              </div>
              <div className="text-xs text-muted-foreground">Sorted by distance from centroid — bottom rows are defect candidates.</div>
              <div className="max-h-[420px] overflow-auto text-xs">
                <table className="w-full">
                  <thead className="text-muted-foreground">
                    <tr><th className="text-left">name</th><th className="text-right">d</th></tr>
                  </thead>
                  <tbody>
                    {regionMembers.map((m) => (
                      <tr key={m.b.id} className="border-t border-border/40 cursor-pointer hover:bg-accent/30"
                        onClick={() => setSelectedId(m.b.id)}>
                        <td className="py-1">{m.b.name}</td>
                        <td className="py-1 text-right tabular-nums">{m.d.toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {!selectedBottle && !selectedRegion ? (
            <div className="text-xs text-muted-foreground border border-dashed border-border rounded p-3">
              Click a point for bottle detail. Click a region in the table below to isolate it.
            </div>
          ) : null}
        </div>
      </div>

      {/* Barolo vs Napa Cab distance */}
      {baroloNapa && (
        <div className="text-sm border border-border rounded p-3 bg-card">
          <div className="font-medium mb-1">Barolo ↔ Napa Cabernet centroid distance</div>
          <div className="text-xs">
            n(Barolo)={baroloNapa.baroloN}, n(Napa Cab)={baroloNapa.napaN};
            distance = <span className="tabular-nums">{baroloNapa.dist.toFixed(3)}</span>{" "}
            = <span className="tabular-nums">{baroloNapa.ratio.toFixed(2)}×</span> catalog dispersion.
            {baroloNapa.ratio < 1
              ? " ⚠︎ Below 1× — the pipeline is not discriminating two of the most stylistically opposed regions."
              : baroloNapa.ratio < 2
                ? " Modest separation."
                : " Healthy separation."}
          </div>
        </div>
      )}

      {/* Known-answer verdicts */}
      <div className="space-y-2">
        <h2 className="font-medium text-sm">Known-answer regions (type: {type})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          {presetResult.known.length === 0 && (
            <div className="text-muted-foreground">No known-answer presets defined for this type.</div>
          )}
          {presetResult.known.map((r) => (
            <div key={r.def.label} className="border border-border rounded p-2 bg-card">
              <div className="flex justify-between mb-1">
                <span className="font-medium">{r.def.label}</span>
                <span className="text-muted-foreground">n={r.count} · coh(full)={r.coherenceFull.toFixed(2)} · coh(2D)={r.coherence2D.toFixed(2)}</span>
              </div>
              {r.count === 0 ? (
                <div className="text-muted-foreground">No matching rows in catalog.</div>
              ) : (
                <div className="space-y-0.5">
                  {r.verdicts.map((v) => (
                    <div key={v.axis} className="flex justify-between">
                      <span>
                        {v.axis}: want <span className="text-muted-foreground">{v.want}</span>,
                        got <span className="tabular-nums">{v.value.toFixed(2)}</span> ({v.got})
                      </span>
                      <span className={v.ok ? "text-emerald-500" : "text-rose-500"}>
                        {v.ok ? "match" : "miss"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {r.def.note && <div className="text-muted-foreground mt-1">Note: {r.def.note}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Control-group */}
      <div className="space-y-2">
        <h2 className="font-medium text-sm">Control group (should have coherence ≈ 1.0)</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
          {presetResult.control.map((r) => (
            <div key={r.def.label} className="border border-border rounded p-2 bg-card">
              <div className="flex justify-between">
                <span className="font-medium">{r.def.label}</span>
                <span className="text-muted-foreground">n={r.count}</span>
              </div>
              <div>
                coh(full) = <span className="tabular-nums">{r.coherenceFull.toFixed(2)}</span>
                {r.coherenceFull < 0.7 && (
                  <span className="text-rose-500 ml-2">
                    ⚠︎ &lt; 0.7 — as tight as a style region. If control groups this broad
                    are this tight, the metric is measuring sample size, not style.
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Best axis pairs */}
      <div className="space-y-2">
        <h2 className="font-medium text-sm">Axis pairs by region separation (top 6)</h2>
        <div className="text-xs text-muted-foreground">Higher score = better 2D separation of the 15 largest regions.</div>
        <ul className="text-xs grid grid-cols-2 md:grid-cols-3 gap-1">
          {bestPairs.slice(0, 6).map((p) => (
            <li key={`${p.x}-${p.y}`}>
              <button
                className="underline-offset-2 hover:underline"
                onClick={() => { setXAxis(p.x); setYAxis(p.y); }}>
                {p.x} × {p.y}
              </button>
              <span className="text-muted-foreground"> — score {p.score.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Coherence table */}
      <div className="space-y-2">
        <h2 className="font-medium text-sm">All regions with 30+ wines (type: {type})</h2>
        <div className="text-xs text-muted-foreground">
          Coherence = region dispersion / catalog dispersion (full active-axis space).
          Values well below 1.0 = a real style; near 1.0 = geography, not style.
          Click a region to isolate it in the plot.
        </div>
        <div className="max-h-[500px] overflow-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background border-b border-border">
              <tr>
                <th className="text-left p-2 cursor-pointer" onClick={() => setTableSort({ key: "region", dir: (tableSort.key === "region" ? -tableSort.dir : 1) as 1|-1 })}>region</th>
                <th className="text-right p-2 cursor-pointer" onClick={() => setTableSort({ key: "count", dir: 1 })}>n</th>
                <th className="text-right p-2 cursor-pointer" onClick={() => setTableSort({ key: "coherence", dir: (tableSort.key === "coherence" ? -tableSort.dir : 1) as 1|-1 })}>coherence (full)</th>
                <th className="text-right p-2">coh (2D)</th>
                {axes.map((a) => (
                  <th key={a} className="text-right p-2 text-muted-foreground">{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRegionStats.map((r) => (
                <tr key={r.region}
                  onClick={() => { setSelectedRegion(r.region); setSelectedId(null); }}
                  className={`border-t border-border/30 cursor-pointer hover:bg-accent/30 ${selectedRegion === r.region ? "bg-accent/40" : ""}`}>
                  <td className="p-2">{r.region}</td>
                  <td className="p-2 text-right tabular-nums">{r.count}</td>
                  <td className={`p-2 text-right tabular-nums ${r.coherenceFull < 0.7 ? "text-emerald-500" : r.coherenceFull > 0.95 ? "text-rose-500" : ""}`}>{r.coherenceFull.toFixed(2)}</td>
                  <td className="p-2 text-right tabular-nums">{(region2D.get(r.region) ?? 0).toFixed(2)}</td>
                  {axes.map((a) => (
                    <td key={a} className="p-2 text-right tabular-nums text-muted-foreground">{r.centroid[a].toFixed(2)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
