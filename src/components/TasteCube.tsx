import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Billboard, Text, Line } from "@react-three/drei";
import * as THREE from "three";
import type { PaletteType } from "@/lib/palate";
import type { LovedPoint } from "./TasteMap";

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
      {
        key: "classic",
        label: "Classic",
        axes: ["body", "fruit", "tannin"],
        labels: [["Light", "Bold"], ["Fruit-forward", "Earthy"], ["Silky", "Grippy"]],
      },
      {
        key: "structure",
        label: "Structure",
        axes: ["tannin", "acidity", "body"],
        labels: [["Silky", "Grippy"], ["Soft", "Zingy"], ["Light", "Bold"]],
      },
      {
        key: "style",
        label: "Style",
        axes: ["body", "sweet", "ripe"],
        labels: [["Light", "Bold"], ["Dry", "Sweet"], ["Fresh", "Ripe"]],
      },
    ];
  }
  return [
    {
      key: "classic",
      label: "Classic",
      axes: ["body", "fruit", "oak"],
      labels: [["Light", "Bold"], ["Fruit-forward", "Mineral"], ["Unoaked", "Oaky"]],
    },
    {
      key: "structure",
      label: "Structure",
      axes: ["oak", "acidity", "body"],
      labels: [["Unoaked", "Oaky"], ["Soft", "Zingy"], ["Light", "Bold"]],
    },
    {
      key: "style",
      label: "Style",
      axes: ["body", "sweet", "ripe"],
      labels: [["Light", "Bold"], ["Dry", "Sweet"], ["Fresh", "Ripe"]],
    },
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

function Dot({
  p, x, y, z, isLoved, isSelected, isCanon, isNemesis, onSelect,
}: {
  p: LovedPoint;
  x: number; y: number; z: number;
  isLoved: boolean;
  isSelected: boolean;
  isCanon: boolean;
  isNemesis: boolean;
  onSelect: (p: LovedPoint) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const targetPos = useMemo(() => new THREE.Vector3(x, y, z), [x, y, z]);

  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    m.position.lerp(targetPos, 0.12);
  });

  const baseR = isLoved
    ? (p.stars >= 5 ? 0.055 : 0.045)
    : 0.028;
  const color = isLoved
    ? GOLD
    : (p.stars === 3 ? "#8a8078" : "#5a4a44");

  const haloColor = isCanon ? GOLD : isNemesis ? "#c14a4a" : null;

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
          color={color}
          emissive={color}
          emissiveIntensity={isLoved ? 0.35 : 0.05}
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
          <meshBasicMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} />
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

function AxisLabel({ position, text }: { position: [number, number, number]; text: string }) {
  return (
    <Billboard position={position} follow>
      <Text
        fontSize={0.09}
        color="#7a6f66"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.15}
        outlineWidth={0.004}
        outlineColor="#000"
        outlineOpacity={0.3}
      >
        {text.toUpperCase()}
      </Text>
    </Billboard>
  );
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

function SceneContent({
  loved, others, canonIds, nemesisIds, preset, selectedKey, onSelect, autoRotateEnabled, controlsRef,
}: {
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
        // Rotate camera around Y axis relative to target
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
        camera.position.set(2.4, 1.6, 2.8);
        camera.lookAt(0, 0, 0);
        orbitRef.current?.update();
      },
    };
  }, [camera, controlsRef]);

  // Cap pixel ratio
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

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 5]} intensity={0.6} />
      <directionalLight position={[-3, -2, -1]} intensity={0.25} />

      <CubeEdges />
      <AxisCrosshair />

      {/* Pole labels — one per face center */}
      <AxisLabel position={[-1.22, 0, 0]} text={lx[0]} />
      <AxisLabel position={[ 1.22, 0, 0]} text={lx[1]} />
      <AxisLabel position={[0, -1.22, 0]} text={ly[0]} />
      <AxisLabel position={[0,  1.22, 0]} text={ly[1]} />
      <AxisLabel position={[0, 0, -1.22]} text={lz[0]} />
      <AxisLabel position={[0, 0,  1.22]} text={lz[1]} />

      {points.map(({ p, isLoved, x, y, z }) => (
        <Dot
          key={p.key}
          p={p}
          x={x} y={y} z={z}
          isLoved={isLoved}
          isSelected={selectedKey === p.key}
          isCanon={!!(p.bottleId && canonIds?.has(p.bottleId))}
          isNemesis={!!(p.bottleId && nemesisIds?.has(p.bottleId))}
          onSelect={onSelect}
        />
      ))}

      <OrbitControls
        ref={orbitRef}
        enablePan={false}
        enableZoom
        minDistance={2.2}
        maxDistance={6}
        autoRotate={autoRotateEnabled}
        autoRotateSpeed={0.7} // ~one revolution / 30s
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

  // Reset preset when wine type changes (axes differ).
  useEffect(() => { setPresetKey("classic"); }, [type]);

  // Auto-rotate + idle logic
  const [autoRotate, setAutoRotate] = useState(true);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpIdle = () => {
    setAutoRotate(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setAutoRotate(true), 5000);
  };
  useEffect(() => () => { if (idleTimer.current) clearTimeout(idleTimer.current); }, []);

  // Pause rendering when off-screen or tab hidden
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

  // Keyboard arrows
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
          camera={{ position: [2.4, 1.6, 2.8], fov: 42 }}
          onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}
        >
          <Suspense fallback={null}>
            <SceneContent
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
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-muted-foreground/40" />
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
