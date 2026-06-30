import type { AxisDef, LetterResult } from "@/lib/palate";

type Props = {
  axes: AxisDef[];
  letters: LetterResult[];
  size?: number;
};

const SPOKE_ANGLES_DEG = [-90, -18, 54, 126, 198];

const SIZE = 320;
const CX = SIZE / 2;
const CY = SIZE / 2;
const SPOKE_LEN = 108;
const LETTER_R = 132;
const LABEL_R = 152;

function toRad(d: number) { return (d * Math.PI) / 180; }
function pt(angleDeg: number, r: number) {
  return [CX + r * Math.cos(toRad(angleDeg)), CY + r * Math.sin(toRad(angleDeg))] as const;
}

function needlePath(angleDeg: number, len: number, baseHalf = 4) {
  const [ox, oy] = pt(angleDeg, len);
  const perp = angleDeg + 90;
  const [px, py] = [Math.cos(toRad(perp)) * baseHalf, Math.sin(toRad(perp)) * baseHalf];
  const [bx1, by1] = [CX + px, CY + py];
  const [bx2, by2] = [CX - px, CY - py];
  return `M ${bx1.toFixed(2)} ${by1.toFixed(2)} L ${ox.toFixed(2)} ${oy.toFixed(2)} L ${bx2.toFixed(2)} ${by2.toFixed(2)} Z`;
}

const AXIS_COLOR: Record<string, string> = {
  body: "var(--color-axis-body)",
  fruit_char: "var(--color-axis-fruit)",
  tannin: "var(--color-axis-tannin)",
  oak: "var(--color-axis-oak)",
  acidity: "var(--color-axis-acidity)",
  sweet: "var(--color-axis-sweet)",
};

export function PalateStar({ axes, letters, size = SIZE }: Props) {
  const byAxis = new Map(letters.map((l) => [l.axis, l]));

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={size}
      height={size}
      role="img"
      aria-label="Palate star"
      className="block mx-auto"
    >
      <circle cx={CX} cy={CY} r={SPOKE_LEN} fill="none" stroke="var(--color-border)" strokeOpacity="0.5" strokeDasharray="2 4" />
      <circle cx={CX} cy={CY} r={5} fill="var(--color-card)" stroke="var(--color-border)" />

      {axes.map((axisDef, i) => {
        const angle = SPOKE_ANGLES_DEG[i];
        const result = byAxis.get(axisDef.key);
        if (!result) return null;

        const axisColor = AXIS_COLOR[axisDef.key] ?? "var(--color-primary)";
        const isResolved = result.resolved;
        const dim = !isResolved;

        const highAngle = angle;
        const lowAngle = angle + 180;

        const highLit = isResolved && (result.letter === axisDef.high || result.bimodal);
        const lowLit = isResolved && (result.letter === axisDef.low || result.bimodal);
        const neutralLit = isResolved && result.letter === "N" && !result.bimodal;

        const dimColor = `color-mix(in oklab, ${axisColor} 40%, transparent)`;
        const veryDimColor = `color-mix(in oklab, var(--color-muted-foreground) 35%, transparent)`;

        const highFill = highLit ? axisColor : dim ? veryDimColor : dimColor;
        const lowFill = lowLit ? axisColor : dim ? veryDimColor : dimColor;

        let markerPos: readonly [number, number] | null = null;
        if (isResolved && !result.bimodal && result.value !== null) {
          const offset = (result.value - 0.5) * 2 * SPOKE_LEN;
          markerPos = pt(highAngle, offset);
        }

        const [hLetterX, hLetterY] = pt(highAngle, LETTER_R);
        const [lLetterX, lLetterY] = pt(lowAngle, LETTER_R);
        const [labelX, labelY] = pt(highAngle, LABEL_R);

        const highLetterColor = highLit ? axisColor : dim ? veryDimColor : dimColor;
        const lowLetterColor = lowLit ? axisColor : dim ? veryDimColor : dimColor;

        return (
          <g key={axisDef.key}>
            <path d={needlePath(highAngle, SPOKE_LEN)} fill={highFill} opacity={dim ? 0.6 : 1} />
            <path d={needlePath(lowAngle, SPOKE_LEN)} fill={lowFill} opacity={dim ? 0.6 : 1} />

            {markerPos && (
              <circle cx={markerPos[0]} cy={markerPos[1]} r={6} fill={axisColor}
                stroke="var(--color-background)" strokeWidth={2} />
            )}
            {neutralLit && (
              <circle cx={CX} cy={CY} r={7} fill="var(--color-primary)" stroke="var(--color-background)" strokeWidth={2} />
            )}

            <text x={hLetterX} y={hLetterY} textAnchor="middle" dominantBaseline="central"
              fontFamily="var(--font-serif)" fontSize="18" fill={highLetterColor}
              fontWeight={highLit ? 600 : 400}>{axisDef.high}</text>
            <text x={lLetterX} y={lLetterY} textAnchor="middle" dominantBaseline="central"
              fontFamily="var(--font-serif)" fontSize="18" fill={lowLetterColor}
              fontWeight={lowLit ? 600 : 400}>{axisDef.low}</text>

            <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="central"
              fontSize="9" fill="var(--color-muted-foreground)"
              style={{ textTransform: "uppercase", letterSpacing: "0.15em" }}>{axisDef.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
