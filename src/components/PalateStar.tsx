import type { AxisDef, LetterResult } from "@/lib/palate";

type Props = {
  axes: AxisDef[];
  letters: LetterResult[];
  size?: number;
  highlightAxis?: string | null;
  onAxisTap?: (axisKey: string) => void;
};

const SPOKE_ANGLES_DEG = [-90, -18, 54, 126, 198];

const VB = 380;
const CX = VB / 2;
const CY = VB / 2;
const RIM = 110;
const LABEL_R = RIM + 18;

function toRad(d: number) { return (d * Math.PI) / 180; }
function pt(angleDeg: number, r: number) {
  return [CX + r * Math.cos(toRad(angleDeg)), CY + r * Math.sin(toRad(angleDeg))] as const;
}

function anchorFor(angleDeg: number): "start" | "middle" | "end" {
  const c = Math.cos(toRad(angleDeg));
  if (c > 0.2) return "start";
  if (c < -0.2) return "end";
  return "middle";
}

export function PalateStar({ axes, letters, size = 320, highlightAxis, onAxisTap }: Props) {
  const byAxis = new Map(letters.map((l) => [l.axis, l]));
  const hasHighlight = !!highlightAxis;

  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      width={size}
      height={size}
      role="img"
      aria-label="Palate star"
      className="block mx-auto max-w-full h-auto"
    >
      {/* Guide rings */}
      <circle cx={CX} cy={CY} r={RIM} fill="none" stroke="var(--color-border)" strokeOpacity="0.6" strokeDasharray="2 4" />
      <circle cx={CX} cy={CY} r={RIM / 2} fill="none" stroke="var(--color-border)" strokeOpacity="0.3" strokeDasharray="2 4" />
      <circle cx={CX} cy={CY} r={2.5} fill="var(--color-muted-foreground)" opacity="0.5" />

      {axes.map((axisDef, i) => {
        const angle = SPOKE_ANGLES_DEG[i];
        const result = byAxis.get(axisDef.key);
        const resolved = result?.resolved ?? false;
        const highlighted = highlightAxis === axisDef.key;
        const groupOpacity = hasHighlight ? (highlighted ? 1 : 0.45) : 1;
        const spokeOpacity = resolved ? 1 : 0.4;

        const [ex, ey] = pt(angle, RIM);
        const [lx, ly] = pt(angle, LABEL_R);
        const anchor = anchorFor(angle);

        // dot positions
        let dots: { x: number; y: number; r: number; letter?: string }[] = [];
        if (result && resolved) {
          if (result.bimodal) {
            const [x1, y1] = pt(angle, 0.25 * RIM);
            const [x2, y2] = pt(angle, 0.75 * RIM);
            dots = [
              { x: x1, y: y1, r: 4 },
              { x: x2, y: y2, r: 4, letter: "N" },
            ];
          } else if (result.value !== null) {
            const [x, y] = pt(angle, result.value * RIM);
            dots = [{ x, y, r: 5.5, letter: result.letter }];
          }
        }

        return (
          <g
            key={axisDef.key}
            style={{ cursor: onAxisTap ? "pointer" : undefined, opacity: groupOpacity }}
            onClick={onAxisTap ? () => onAxisTap(axisDef.key) : undefined}
          >
            {/* Spoke */}
            <line
              x1={CX} y1={CY} x2={ex} y2={ey}
              stroke="var(--color-border)" strokeWidth={1}
              opacity={spokeOpacity}
            />

            {/* Dots + letters */}
            {dots.map((d, idx) => {
              const letterAngle = angle;
              const cos = Math.cos(toRad(letterAngle));
              const sin = Math.sin(toRad(letterAngle));
              // letter offset perpendicular-ish so it sits outward/sideways
              const off = 12;
              const lxo = d.x + cos * 2 + (Math.abs(cos) < 0.2 ? off : 0) * Math.sign(cos || 1);
              const lyo = d.y + sin * 2 - 6;
              const letterAnchor = anchor;
              return (
                <g key={idx}>
                  <circle cx={d.x} cy={d.y} r={d.r} fill="var(--color-primary)"
                    stroke="var(--color-background)" strokeWidth={2} />
                  {d.letter && (
                    <text x={lxo} y={lyo} textAnchor={letterAnchor} dominantBaseline="central"
                      fontFamily="var(--font-serif)" fontSize="17" fontWeight={500} fill="var(--color-primary)">
                      {d.letter}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Rim labels — both muted, never emphasized */}
            <text x={lx} y={ly - 6} textAnchor={anchor} dominantBaseline="central"
              fontSize="11" fill="var(--color-muted-foreground)">
              {axisDef.label.toLowerCase()}
            </text>
            <text x={lx} y={ly + 7} textAnchor={anchor} dominantBaseline="central"
              fontSize="11" fill="var(--color-muted-foreground)">
              {axisDef.low} → {axisDef.high}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
