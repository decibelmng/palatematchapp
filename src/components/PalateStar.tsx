import { AXES, type LetterResult } from "@/lib/palate";

type Props = {
  letters: LetterResult[];
  size?: number;
};

// Angles in degrees for each axis, starting at top going clockwise.
// Order follows AXES: body, fruit_char, tannin, acidity, sweet.
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

/** Build a tapered needle polygon from center → outer pole at the given angle. */
function needlePath(angleDeg: number, len: number, baseHalf = 4) {
  const [ox, oy] = pt(angleDeg, len);
  const perp = angleDeg + 90;
  const [px, py] = [Math.cos(toRad(perp)) * baseHalf, Math.sin(toRad(perp)) * baseHalf];
  // base near center (slightly offset so two needles don't overlap awkwardly), tip at outer
  const [bx1, by1] = [CX + px, CY + py];
  const [bx2, by2] = [CX - px, CY - py];
  return `M ${bx1.toFixed(2)} ${by1.toFixed(2)} L ${ox.toFixed(2)} ${oy.toFixed(2)} L ${bx2.toFixed(2)} ${by2.toFixed(2)} Z`;
}

export function PalateStar({ letters, size = SIZE }: Props) {
  // Map by axis key in case order shifts.
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
      {/* faint guide circle */}
      <circle cx={CX} cy={CY} r={SPOKE_LEN} fill="none" stroke="var(--color-border)" strokeOpacity="0.35" strokeDasharray="2 4" />

      {/* neutral center */}
      <circle cx={CX} cy={CY} r={5} fill="var(--color-card)" stroke="var(--color-border)" />

      {AXES.map((axisDef, i) => {
        const angle = SPOKE_ANGLES_DEG[i];
        const result = byAxis.get(axisDef.key);
        if (!result) return null;

        const isNa = result.na;
        const isResolved = result.resolved;
        const dim = isNa || !isResolved;

        // Two ends: high pole at `angle`, low pole at angle+180
        const highAngle = angle;
        const lowAngle = angle + 180;

        const highLit = isResolved && !isNa && (result.letter === axisDef.high || result.bimodal);
        const lowLit = isResolved && !isNa && (result.letter === axisDef.low || result.bimodal);
        const neutralLit = isResolved && !isNa && result.letter === "N" && !result.bimodal;

        const goldStrong = "var(--color-gold)";
        const goldSoft = "var(--color-gold-soft)";
        const muted = "color-mix(in oklab, var(--color-muted-foreground) 60%, transparent)";
        const veryDim = "color-mix(in oklab, var(--color-muted-foreground) 25%, transparent)";

        const highFill = highLit ? goldStrong : dim ? veryDim : muted;
        const lowFill = lowLit ? goldStrong : dim ? veryDim : muted;

        // Marker for the user's position along the spoke (resolved & not bimodal).
        let markerPos: readonly [number, number] | null = null;
        if (isResolved && !isNa && !result.bimodal && result.value !== null) {
          // value 0 → low end, 1 → high end, 0.5 → center
          const offset = (result.value - 0.5) * 2 * SPOKE_LEN;
          markerPos = pt(highAngle, offset);
        }

        const [hLetterX, hLetterY] = pt(highAngle, LETTER_R);
        const [lLetterX, lLetterY] = pt(lowAngle, LETTER_R);
        const [labelX, labelY] = pt(highAngle, LABEL_R);

        return (
          <g key={axisDef.key}>
            {/* tapered needles in both directions */}
            <path d={needlePath(highAngle, SPOKE_LEN)} fill={highFill} opacity={dim ? 0.5 : 0.9} />
            <path d={needlePath(lowAngle, SPOKE_LEN)} fill={lowFill} opacity={dim ? 0.5 : 0.9} />

            {/* user-position dot */}
            {markerPos && (
              <circle
                cx={markerPos[0]}
                cy={markerPos[1]}
                r={6}
                fill={goldStrong}
                stroke="var(--color-background)"
                strokeWidth={2}
              />
            )}
            {/* neutral center highlight if user is "N" */}
            {neutralLit && (
              <circle cx={CX} cy={CY} r={7} fill={goldStrong} stroke="var(--color-background)" strokeWidth={2} />
            )}

            {/* pole letters */}
            <text
              x={hLetterX} y={hLetterY}
              textAnchor="middle" dominantBaseline="central"
              fontFamily="var(--font-serif)" fontSize="18"
              fill={highLit ? goldStrong : dim ? veryDim : muted}
              fontWeight={highLit ? 600 : 400}
            >{axisDef.high}</text>
            <text
              x={lLetterX} y={lLetterY}
              textAnchor="middle" dominantBaseline="central"
              fontFamily="var(--font-serif)" fontSize="18"
              fill={lowLit ? goldStrong : dim ? veryDim : muted}
              fontWeight={lowLit ? 600 : 400}
            >{axisDef.low}</text>

            {/* tiny axis label near the high-pole end */}
            <text
              x={labelX} y={labelY}
              textAnchor="middle" dominantBaseline="central"
              fontSize="9"
              fill="var(--color-muted-foreground)"
              style={{ textTransform: "uppercase", letterSpacing: "0.15em" }}
            >{axisDef.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
