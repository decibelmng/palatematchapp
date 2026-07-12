import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Billboard, Text, Line } from "@react-three/drei";
import * as THREE from "three";
import type { PaletteType } from "@/lib/palate";
import type { LovedPoint } from "./TasteMap";
import { styleNameFor, type FpVec } from "@/lib/lane-style";
import type { FpKey } from "@/lib/recommender";

type Props = {
  type: PaletteType;
  loved: LovedPoint[];
  others?: LovedPoint[];
  canonIds?: Set<string>;
  nemesisIds?: Set<string>;
  showOverlay?: boolean;
  overlayText?: string;
};

type AxisKey = "body" | "fruit" | "tannin" | "oak" | "acidity" | "sweet" | "ripe";

type PresetKey = "classic" | "structure" | "style";

type Preset = {
  key: PresetKey;
  label: string;
  axes: [AxisKey, AxisKey, AxisKey];
  labels: [[string, string], [string, string], [string, string]]; // [-,+] per axis
};

function presetsFor(type: PaletteType): Preset[] {
  if (type === "red") {
    return [
      { key: "classic",   label: "Classic",   axes: ["body", "fruit", "tannin"],
        labels: [["Light", "Bold"], ["Fruit-forward", "Earthy"], ["Silky", "Grippy"]] },
      { key: "structure", label: "Structure", axes: ["tannin", "acidity", "body"],
        labels: [["Silky", "Grippy"], ["Soft", "Zingy"], ["Light", "Bold"]] },
      { key: "style",     label: "Style",     axes: ["body", "sweet", "ripe"],
        labels: [["Light", "Bold"], ["Dry", "Sweet"], ["Fresh", "Ripe"]] },
    ];
  }
  return [
    { key: "classic",   label: "Classic",   axes: ["body", "fruit", "oak"],
      labels: [["Light", "Bold"], ["Fruit-forward", "Mineral"], ["Unoaked", "Oaky"]] },
    { key: "structure", label: "Structure", axes: ["oak", "acidity", "body"],
      labels: [["Unoaked", "Oaky"], ["Soft", "Zingy"], ["Light", "Bold"]] },
    { key: "style",     label: "Style",     axes: ["body", "sweet", "ripe"],
      labels: [["Light", "Bold"], ["Dry", "Sweet"], ["Fresh", "Ripe"]] },
  ];
}

function getAxis(p: LovedPoint, k: AxisKey): number | undefined {
  switch (k) {
    case "body":    return p.axBody;
    case "fruit":   return p.axFruit;
    case "tannin":  return p.axTannin;
    case "oak":     return p.axOak;
    case "acidity": return p.axAcidity;
    case "sweet":   return p.axSweet;
    case "ripe":    return p.axRipe;
  }
}

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function toWorld(v: number | undefined) {
  return (clamp01(v ?? 0.5) - 0.5) * 2; // -1..1
}

function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}

type Selected =
  | { kind: "loved"; p: LovedPoint }
  | null;

const GOLD = "#d4a03a";
const NEMESIS = "#c14a4a";

// Cube half-extent = 1 (BoxGeometry(2,2,2)). Endpoint labels sit here.
const LABEL_OUT = 1.15;

// ---------- Depth-fade helper for billboarded text/materials ----------
/** Given a camera and a world position, return a 0..1 opacity where the far
 *  face (behind cube) → 0.4 and the near face → 1.0. */
function fadeForDepth(camera: THREE.Camera, worldPos: THREE.Vector3): number {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const toPt = worldPos.clone().sub(camera.position);
  const projected = toPt.dot(forward); // >0 in front of camera; larger = farther
  // Cube spans roughly camera-to-target distance ± √3. Map to [0.4, 1.0].
  // Use a symmetric window based on camera distance.
  const camDist = camera.position.length();
  const nearD = camDist - Math.SQRT2;
  const farD  = camDist + Math.SQRT2;
  const t = THREE.MathUtils.clamp((projected - nearD) / Math.max(0.001, farD - nearD), 0, 1);
  // t=0 → nearest (opacity 1), t=1 → farthest (opacity 0.4)
  return THREE.MathUtils.lerp(1.0, 0.4, t);
}

// ---------- Dot ----------
function Dot({
  p, x, y, z, isLoved, isSelected, hasSelection, isCanon, isNemesis, onSelect,
}: {
  p: LovedPoint;
  x: number; y: number; z: number;
  isLoved: boolean;
  isSelected: boolean;
  hasSelection: boolean;
  isCanon: boolean;
  isNemesis: boolean;
  onSelect: (p: LovedPoint) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const targetPos = useMemo(() => new THREE.Vector3(x, y, z), [x, y, z]);

  // When a selection is active, dim non-selected by ~20%.
  const dimFactor = hasSelection && !isSelected ? 0.8 : 1;

  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    m.position.lerp(targetPos, 0.12);
    if (matRef.current) {
      const base = 1;
      matRef.current.opacity = base * dimFactor;
      matRef.current.transparent = dimFactor < 1;
    }
  });

  // Nemeses render at loved-ish size even if they came from `others`,
  // so the red halo has a visible sphere underneath.
  const visualLoved = isLoved || isNemesis;
  const baseR = visualLoved
    ? (p.stars >= 5 ? 0.055 : 0.045)
    : 0.028;
  const color = isNemesis
    ? NEMESIS
    : (isLoved
        ? GOLD
        : (p.stars === 3 ? "#8a8078" : "#5a4a44"));

  const haloColor = isCanon ? GOLD : isNemesis ? NEMESIS : null;

  const stopProp = (e: ThreeEvent<PointerEvent>) => e.stopPropagation();
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(p);
  };

  return (
    <group>
      <mesh
        ref={meshRef}
        onClick={handleClick}
        onPointerDown={stopProp}
      >
        <sphereGeometry args={[baseR, 20, 20]} />
        <meshStandardMaterial
          ref={matRef}
          color={color}
          emissive={color}
          emissiveIntensity={visualLoved ? 0.35 : 0.05}
          roughness={0.4}
          metalness={0.1}
        />
      </mesh>
      {/* Larger invisible hit sphere for touch */}
      <mesh position={targetPos} onClick={handleClick} onPointerDown={stopProp}>
        <sphereGeometry args={[baseR * 2.4, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {haloColor && (
        <mesh position={targetPos}>
          <torusGeometry args={[baseR * 1.6, baseR * 0.18, 10, 32]} />
          <meshBasicMaterial color={haloColor} transparent opacity={0.9} />
        </mesh>
      )}
      {isSelected && (
        <mesh position={targetPos}>
          <ringGeometry args={[baseR * 1.9, baseR * 2.15, 32]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.95} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}

function CubeEdges() {
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)), []);
  const mat = useMemo(() => new THREE.LineBasicMaterial({ color: 0x9a8f86, transparent: true, opacity: 0.35 }), []);
  return <lineSegments geometry={geo} material={mat} />;
}

function AxisCrosshair() {
  const gray = "#9a8f86";
  const opts = { color: gray, opacity: 0.28, transparent: true, lineWidth: 1 } as const;
  return (
    <group>
      <Line points={[[-1, 0, 0], [1, 0, 0]]} {...opts} />
      <Line points={[[0, -1, 0], [0, 1, 0]]} {...opts} />
      <Line points={[[0, 0, -1], [0, 0, 1]]} {...opts} />
    </group>
  );
}

// ---------- Axis endpoint label (billboarded, depth-faded) ----------
function EndpointLabel({ position, text }: { position: [number, number, number]; text: string }) {
  const textRef = useRef<React.ComponentRef<typeof Text>>(null);
  const world = useMemo(() => new THREE.Vector3(...position), [position]);
  useFrame(({ camera }) => {
    const t = textRef.current;
    if (!t) return;
    const op = fadeForDepth(camera, world);
    // drei Text exposes fillOpacity / outlineOpacity via material props
    (t as unknown as { fillOpacity: number; outlineOpacity: number }).fillOpacity = op;
    (t as unknown as { fillOpacity: number; outlineOpacity: number }).outlineOpacity = op * 0.3;
  });
  return (
    <Billboard position={position} follow>
      <Text
        ref={textRef}
        fontSize={0.09}
        color="#7a6f66"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.15}
        outlineWidth={0.004}
        outlineColor="#000"
      >
        {text.toUpperCase()}
      </Text>
    </Billboard>
  );
}

// ---------- Mode clouds ----------
type ClusterPoint = { p: LovedPoint; v: THREE.Vector3 };
type Cloud = {
  center: THREE.Vector3;
  radius: number;
  label: string;
};

const CLUSTER_MERGE_MAX = 0.9; // world-units (cube spans -1..1)
const CLOUD_PAD = 0.14;
const CLOUD_MIN_R = 0.22;

function clusterCanons(canonPts: ClusterPoint[]): Array<{ members: ClusterPoint[] }> {
  const n = canonPts.length;
  if (n === 0) return [];
  const D: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      D[i][j] = D[j][i] = canonPts[i].v.distanceTo(canonPts[j].v);
    }
  }
  let clusters: { idx: number[]; diameter: number }[] = canonPts.map((_, i) => ({ idx: [i], diameter: 0 }));
  const mergedDiam = (a: number[], b: number[]) => {
    let d = 0;
    for (const i of a) for (const j of b) if (D[i][j] > d) d = D[i][j];
    return d;
  };
  while (clusters.length > 1) {
    let bestI = -1, bestJ = -1, bestDiam = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const cross = mergedDiam(clusters[i].idx, clusters[j].idx);
        const merged = Math.max(clusters[i].diameter, clusters[j].diameter, cross);
        if (merged < bestDiam) { bestDiam = merged; bestI = i; bestJ = j; }
      }
    }
    if (bestDiam > CLUSTER_MERGE_MAX) break;
    const m = { idx: [...clusters[bestI].idx, ...clusters[bestJ].idx], diameter: bestDiam };
    clusters = clusters.filter((_, k) => k !== bestI && k !== bestJ);
    clusters.push(m);
  }
  return clusters.map((c) => ({ members: c.idx.map((i) => canonPts[i]) }));
}

/** Map a LovedPoint's cube axes into a partial FpVec so styleNameFor works.
 *  Only axes present on the point contribute; missing axes default to 0.5. */
function fpFromLoved(p: LovedPoint): FpVec {
  const centroid = 0.5;
  const fp: Record<FpKey, number> = {
    fresh: centroid,
    acid: p.axAcidity ?? centroid,
    tannin: p.axTannin ?? centroid,
    fruit_dark: centroid,
    // axFruit: low = fruit-forward, high = earthy/savory
    ripe: p.axRipe ?? centroid,
    oak: p.axOak ?? centroid,
    body: p.axBody ?? centroid,
    savory: p.axFruit ?? centroid,
  };
  return fp;
}

function laneStyleForCluster(members: ClusterPoint[], type: PaletteType): string {
  const wineType = type === "red" ? "red" : "white";
  // Average FpVec across canon members
  const keys: FpKey[] = ["fresh", "acid", "tannin", "fruit_dark", "ripe", "oak", "body", "savory"];
  const sum: Record<FpKey, number> = { fresh: 0, acid: 0, tannin: 0, fruit_dark: 0, ripe: 0, oak: 0, body: 0, savory: 0 };
  for (const m of members) {
    const fp = fpFromLoved(m.p);
    for (const k of keys) sum[k] += fp[k];
  }
  const avg: FpVec = { fresh: 0, acid: 0, tannin: 0, fruit_dark: 0, ripe: 0, oak: 0, body: 0, savory: 0 };
  for (const k of keys) avg[k] = sum[k] / members.length;
  return styleNameFor(avg, wineType);
}

function ModeCloud({ cloud }: { cloud: Cloud }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const textRef = useRef<React.ComponentRef<typeof Text>>(null);
  // Label positioned at cloud edge, offset toward camera-tangent direction
  const labelPos = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ camera }) => {
    // Fade the cloud sphere slightly by depth so it doesn't blot near dots
    if (matRef.current) {
      const op = fadeForDepth(camera, cloud.center);
      matRef.current.opacity = 0.06 * op + 0.02; // 2–8%
    }
    // Position label at the cloud edge, on the side away from cube center
    const outward = cloud.center.clone().normalize();
    if (outward.lengthSq() < 1e-6) outward.set(0, 1, 0);
    labelPos.copy(cloud.center).addScaledVector(outward, cloud.radius);
    if (textRef.current) {
      (textRef.current as unknown as { position: THREE.Vector3 }).position.copy(labelPos);
      const op = fadeForDepth(camera, labelPos);
      (textRef.current as unknown as { fillOpacity: number; outlineOpacity: number }).fillOpacity = op;
      (textRef.current as unknown as { fillOpacity: number; outlineOpacity: number }).outlineOpacity = op * 0.4;
    }
  });

  return (
    <group>
      <mesh ref={meshRef} position={cloud.center}>
        <sphereGeometry args={[cloud.radius, 24, 20]} />
        <meshBasicMaterial
          ref={matRef}
          color={GOLD}
          transparent
          opacity={0.06}
          depthWrite={false}
        />
      </mesh>
      <Billboard follow>
        <Text
          ref={textRef}
          fontSize={0.07}
          color={GOLD}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.003}
          outlineColor="#000"
          letterSpacing={0.05}
        >
          {cloud.label}
        </Text>
      </Billboard>
    </group>
  );
}

// ---------- Scene ----------
function SceneContent({
  type, loved, others, canonIds, nemesisIds, preset, selectedKey, onSelect, autoRotateEnabled, controlsRef,
}: {
  type: PaletteType;
  loved: LovedPoint[];
  others: LovedPoint[];
  canonIds?: Set<string>;
  nemesisIds?: Set<string>;
  preset: Preset;
  selectedKey: string | null;
  onSelect: (p: LovedPoint) => void;
  autoRotateEnabled: boolean;
  controlsRef: React.MutableRefObject<{ rotateY: (delta: number) => void; rotateX: (delta: number) => void; reset: () => void } | null>;
}) {
  const { camera, gl } = useThree();
  const orbitRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);

  useEffect(() => {
    controlsRef.current = {
      rotateY: (delta: number) => {
        const target = orbitRef.current?.target ?? new THREE.Vector3();
        const offset = camera.position.clone().sub(target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.theta += delta;
        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset);
        camera.lookAt(target);
        orbitRef.current?.update();
      },
      rotateX: (delta: number) => {
        const target = orbitRef.current?.target ?? new THREE.Vector3();
        const offset = camera.position.clone().sub(target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        spherical.phi = Math.max(0.15, Math.min(Math.PI - 0.15, spherical.phi + delta));
        offset.setFromSpherical(spherical);
        camera.position.copy(target).add(offset);
        camera.lookAt(target);
        orbitRef.current?.update();
      },
      reset: () => {
        camera.position.set(3.4, 2.2, 3.9);
        camera.lookAt(0, 0, 0);
        orbitRef.current?.update();
      },
    };
  }, [camera, controlsRef]);

  useEffect(() => {
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }, [gl]);

  const [ax, ay, az] = preset.axes;
  const [lx, ly, lz] = preset.labels;

  const points = useMemo(() => {
    const items = [...loved.map((p) => ({ p, isLoved: true })), ...others.map((p) => ({ p, isLoved: false }))];
    return items.map(({ p, isLoved }) => ({
      p,
      isLoved,
      x: toWorld(getAxis(p, ax)),
      y: toWorld(getAxis(p, ay)),
      z: toWorld(getAxis(p, az)),
    }));
  }, [loved, others, ax, ay, az]);

  // ---- Compute mode clouds around Canon-led clusters ----
  const clouds = useMemo<Cloud[]>(() => {
    if (!canonIds || canonIds.size === 0) return [];
    // Canon points (all sources — canons should be loved but include others too if present)
    const canonPts: ClusterPoint[] = points
      .filter(({ p }) => p.bottleId && canonIds.has(p.bottleId))
      .map(({ p, x, y, z }) => ({ p, v: new THREE.Vector3(x, y, z) }));
    if (canonPts.length === 0) return [];

    const clusters = clusterCanons(canonPts);
    // For each cluster, attract nearby LOVED (non-canon, non-nemesis) points within CLUSTER_MERGE_MAX/2
    const attractR = CLUSTER_MERGE_MAX * 0.55;
    const canonKeys = new Set(canonPts.map((c) => c.p.key));

    return clusters.map(({ members }) => {
      const canonCentroid = new THREE.Vector3();
      for (const m of members) canonCentroid.add(m.v);
      canonCentroid.divideScalar(members.length);

      // Include nearby loved (not canon, not nemesis) to swell the cloud
      const nearby: ClusterPoint[] = points
        .filter(({ p, isLoved }) =>
          isLoved &&
          !canonKeys.has(p.key) &&
          !(p.bottleId && nemesisIds?.has(p.bottleId))
        )
        .map(({ p, x, y, z }) => ({ p, v: new THREE.Vector3(x, y, z) }))
        .filter(({ v }) => v.distanceTo(canonCentroid) <= attractR);

      const all = [...members, ...nearby];
      const centroid = new THREE.Vector3();
      for (const m of all) centroid.add(m.v);
      centroid.divideScalar(all.length);

      const maxR = all.reduce((m, p) => Math.max(m, p.v.distanceTo(centroid)), 0);
      const radius = Math.max(CLOUD_MIN_R, maxR + CLOUD_PAD);

      const label = laneStyleForCluster(members, type);
      return { center: centroid, radius, label };
    });
  }, [points, canonIds, nemesisIds, type]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 5]} intensity={0.6} />
      <directionalLight position={[-3, -2, -1]} intensity={0.25} />

      <CubeEdges />
      <AxisCrosshair />

      {/* Mode clouds — behind everything */}
      {clouds.map((c, i) => <ModeCloud key={i} cloud={c} />)}

      {/* Pole endpoint labels (billboarded, depth-faded) */}
      <EndpointLabel position={[-LABEL_OUT, 0, 0]} text={lx[0]} />
      <EndpointLabel position={[ LABEL_OUT, 0, 0]} text={lx[1]} />
      <EndpointLabel position={[0, -LABEL_OUT, 0]} text={ly[0]} />
      <EndpointLabel position={[0,  LABEL_OUT, 0]} text={ly[1]} />
      <EndpointLabel position={[0, 0, -LABEL_OUT]} text={lz[0]} />
      <EndpointLabel position={[0, 0,  LABEL_OUT]} text={lz[1]} />

      {points.map(({ p, isLoved, x, y, z }) => (
        <Dot
          key={p.key}
          p={p}
          x={x} y={y} z={z}
          isLoved={isLoved}
          isSelected={selectedKey === p.key}
          hasSelection={selectedKey !== null}
          isCanon={!!(p.bottleId && canonIds?.has(p.bottleId))}
          isNemesis={!!(p.bottleId && nemesisIds?.has(p.bottleId))}
          onSelect={onSelect}
        />
      ))}

      <OrbitControls
        ref={orbitRef}
        enablePan={false}
        enableZoom
        minDistance={4}
        maxDistance={8}
        autoRotate={autoRotateEnabled}
        autoRotateSpeed={0.7}
        dampingFactor={0.12}
        enableDamping
      />
    </>
  );
}

export function TasteCube({
  type, loved, others = [], canonIds, nemesisIds, showOverlay, overlayText,
}: Props) {
  const [selected, setSelected] = useState<Selected>(null);
  const [presetKey, setPresetKey] = useState<PresetKey>("classic");
  const presets = useMemo(() => presetsFor(type), [type]);
  const preset = presets.find((p) => p.key === presetKey) ?? presets[0];

  useEffect(() => { setPresetKey("classic"); setSelected(null); }, [type]);

  const [autoRotate, setAutoRotate] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpIdle = () => {
    setAutoRotate(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setAutoRotate(true), 5000);
  };
  useEffect(() => () => { if (idleTimer.current) clearTimeout(idleTimer.current); }, []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    const onVis = () => setVisible(!document.hidden && (wrapRef.current?.getBoundingClientRect().bottom ?? 0) > 0);
    document.addEventListener("visibilitychange", onVis);
    return () => { io.disconnect(); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const controlsRef = useRef<{ rotateY: (d: number) => void; rotateX: (d: number) => void; reset: () => void } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const step = (15 * Math.PI) / 180;
      if (e.key === "ArrowLeft") { controlsRef.current?.rotateY(-step); bumpIdle(); }
      else if (e.key === "ArrowRight") { controlsRef.current?.rotateY(step); bumpIdle(); }
      else if (e.key === "ArrowUp") { controlsRef.current?.rotateX(-step); bumpIdle(); }
      else if (e.key === "ArrowDown") { controlsRef.current?.rotateX(step); bumpIdle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const step = (deg: number) => (deg * Math.PI) / 180;

  return (
    <div className="w-full max-w-[480px] mx-auto" ref={wrapRef}>
      <div
        className="relative w-full aspect-square rounded-[14px] border-[0.5px] border-border bg-card/40 overflow-hidden shadow-[var(--pm-card-shadow)]"
        onPointerDown={bumpIdle}
        onWheel={bumpIdle}
        onDoubleClick={() => { controlsRef.current?.reset(); bumpIdle(); }}
      >
        <Canvas
          frameloop={visible ? "always" : "never"}
          // fov=36 + distance ~5.6 → cube diagonal (~1.73) + labels (±1.15)
          // stay inside the viewport at every rotation.
          camera={{ position: [3.4, 2.2, 3.9], fov: 36 }}
          onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}
        >
          <Suspense fallback={null}>
            <SceneContent
              type={type}
              loved={loved}
              others={others}
              canonIds={canonIds}
              nemesisIds={nemesisIds}
              preset={preset}
              selectedKey={selected?.kind === "loved" ? selected.p.key : null}
              onSelect={(p) => setSelected({ kind: "loved", p })}
              autoRotateEnabled={autoRotate}
              controlsRef={controlsRef}
            />
          </Suspense>
        </Canvas>

        {/* On-screen arrow controls */}
        <div className="absolute inset-x-0 top-2 flex justify-center pointer-events-none">
          <button
            type="button"
            aria-label="Rotate up"
            onClick={() => { controlsRef.current?.rotateX(-step(15)); bumpIdle(); }}
            className="pointer-events-auto rounded-full border-[0.5px] border-border bg-background/70 backdrop-blur px-2 py-1 text-xs hover:bg-accent"
          >▲</button>
        </div>
        <div className="absolute inset-x-0 bottom-2 flex justify-center pointer-events-none">
          <button
            type="button"
            aria-label="Rotate down"
            onClick={() => { controlsRef.current?.rotateX(step(15)); bumpIdle(); }}
            className="pointer-events-auto rounded-full border-[0.5px] border-border bg-background/70 backdrop-blur px-2 py-1 text-xs hover:bg-accent"
          >▼</button>
        </div>
        <div className="absolute inset-y-0 left-2 flex items-center pointer-events-none">
          <button
            type="button"
            aria-label="Rotate left"
            onClick={() => { controlsRef.current?.rotateY(-step(15)); bumpIdle(); }}
            className="pointer-events-auto rounded-full border-[0.5px] border-border bg-background/70 backdrop-blur px-2 py-1 text-xs hover:bg-accent"
          >◀</button>
        </div>
        <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none">
          <button
            type="button"
            aria-label="Rotate right"
            onClick={() => { controlsRef.current?.rotateY(step(15)); bumpIdle(); }}
            className="pointer-events-auto rounded-full border-[0.5px] border-border bg-background/70 backdrop-blur px-2 py-1 text-xs hover:bg-accent"
          >▶</button>
        </div>

        {showOverlay && (
          <div className="absolute inset-0 grid place-items-center bg-background/55">
            <p className="font-serif text-[15px] text-foreground">{overlayText ?? "Where do you land?"}</p>
          </div>
        )}
      </div>

      {/* Callout — same footprint as TasteMap */}
      <div className="mt-3 min-h-[64px] rounded-[14px] border-[0.5px] border-border bg-card/60 px-4 py-3 shadow-[var(--pm-card-shadow)]">
        {selected ? (
          <Callout p={selected.p} />
        ) : (
          <p className="text-muted-foreground text-center text-[12px]">Tap any sphere to see the wine · drag to rotate · double-tap to reset</p>
        )}
      </div>

      {/* Axis preset chips */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        {presets.map((p) => {
          const on = p.key === presetKey;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setPresetKey(p.key)}
              aria-pressed={on}
              className={`rounded-full border-[0.5px] px-2.5 py-0.5 text-[10px] uppercase transition ${
                on ? "border-primary bg-primary/10 text-foreground"
                   : "border-border text-muted-foreground hover:bg-accent"
              }`}
              style={{ letterSpacing: "0.14em" }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Legend — mirrors TasteMap */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: GOLD }} />
          Wines you love
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: NEMESIS }} />
          Wines you avoid
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: GOLD }} />
          Canons
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-destructive" />
          Nemeses
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: GOLD, opacity: 0.15 }} />
          Style clouds
        </span>
      </div>
    </div>
  );
}

function Callout({ p }: { p: LovedPoint }) {
  const meta = [p.producer, p.region].filter(Boolean).join(" · ");
  const stars = "★".repeat(p.stars) + "☆".repeat(5 - p.stars);
  return (
    <div className="pm-rise">
      <div className="font-serif text-[17px] leading-snug text-foreground truncate">{p.name}</div>
      {meta && <div className="text-[13px] text-muted-foreground truncate">{meta}</div>}
      <div className="mt-1 text-primary text-[14px]" style={{ letterSpacing: "0.15em" }}>{stars}</div>
    </div>
  );
}

export function useHasWebGL(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => { setOk(detectWebGL()); }, []);
  return ok;
}
