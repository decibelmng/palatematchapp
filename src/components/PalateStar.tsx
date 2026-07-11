import { useEffect, useState } from "react";
import type { AxisDef, LetterResult } from "@/lib/palate";

type Props = {
  axes: AxisDef[];
  letters: LetterResult[];
  size?: number;
  animate?: boolean;
};

const SPOKE_ANGLES_DEG = [-90, -18, 54, 126, 198];
const VB = 240;
const CX = VB / 2;
const CY = VB / 2;
const RIM = 100;

function toRad(d: number) { return (d * Math.PI) / 180; }
function pt(angleDeg: number, r: number) {
  return [CX + r * Math.cos(toRad(angleDeg)), CY + r * Math.sin(toRad(angleDeg))] as const;
}

/** Approximate LetterResult array from a code string like "LNSND" using the
 *  axis set. Used for mini glyphs / example glyphs where exact values aren't
 *  available. */
export function lettersFromCode(code: string, axes: AxisDef[]): LetterResult[] {
  return axes.map((a, i) => {
    const ch = code[i] ?? "·";
    const base = { axis: a.key, label: a.label, low: a.low, high: a.high };
    if (ch === a.low)  return { ...base, letter: ch, descriptor: a.lowName,  resolved: true, value: 0.2, bimodal: false };
    if (ch === a.high) return { ...base, letter: ch, descriptor: a.highName, resolved: true, value: 0.8, bimodal: false };
    if (ch === "N")    return { ...base, letter: "N", descriptor: a.neutralName, resolved: true, value: 0.5, bimodal: false };
    if (ch === "X")    return { ...base, letter: "X", descriptor: "loves both poles", resolved: true, value: 0.5, bimodal: true };
    return { ...base, letter: "·", descriptor: "—", resolved: false, value: null, bimodal: false };
  });
}

export function PalateStar({ axes, letters, size = 240, animate = false }: Props) {
  const byAxis = new Map(letters.map((l) => [l.axis, l]));
  const [t, setT] = useState(animate ? 0 : 1);

  useEffect(() => {
    if (!animate) { setT(1); return; }
    let raf = 0;
    const start = performance.now();
    const DUR = 900;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / DUR);
      // easeOutCubic
      setT(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      role="img"
      aria-label="Palate glyph"
      className="block mx-auto max-w-full h-auto"
    >
      <circle cx={CX} cy={CY} r={RIM} fill="none"
        stroke="var(--color-border)" strokeOpacity="0.6" strokeDasharray="2 4" />
      <circle cx={CX} cy={CY} r={RIM / 2} fill="none"
        stroke="var(--color-border)" strokeOpacity="0.3" strokeDasharray="2 4" />
      <circle cx={CX} cy={CY} r={2.5} fill="var(--color-muted-foreground)" opacity="0.5" />

      {axes.map((axisDef, i) => {
        const angle = SPOKE_ANGLES_DEG[i];
        const result = byAxis.get(axisDef.key);
        const resolved = result?.resolved ?? false;
        const [ex, ey] = pt(angle, RIM);
        // Stagger animation slightly per spoke
        const localT = Math.max(0, Math.min(1, (t - i * 0.06) / (1 - i * 0.03)));

        let dots: { x: number; y: number; r: number }[] = [];
        if (result && resolved) {
          if (result.bimodal) {
            const [x1, y1] = pt(angle, 0.25 * RIM * localT);
            const [x2, y2] = pt(angle, 0.75 * RIM * localT);
            dots = [{ x: x1, y: y1, r: 4 }, { x: x2, y: y2, r: 4 }];
          } else if (result.value !== null) {
            const [x, y] = pt(angle, result.value * RIM * localT);
            dots = [{ x, y, r: 5.5 }];
          }
        }

        return (
          <g key={axisDef.key}>
            <line x1={CX} y1={CY} x2={ex} y2={ey}
              stroke="var(--color-border)" strokeWidth={1}
              opacity={resolved ? 1 : 0.4} />
            {dots.map((d, idx) => (
              <circle key={idx} cx={d.x} cy={d.y} r={d.r}
                fill="var(--color-primary)"
                stroke="var(--color-background)" strokeWidth={2} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
