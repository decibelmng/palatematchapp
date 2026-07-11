import { RAX, type FpKey } from "@/lib/recommender";

type Props = {
  fp: Record<FpKey, number>;
  size?: number;
  className?: string;
  title?: string;
};

/** Tiny 8-axis radar polygon for a fingerprint. Pure SVG, no deps. */
export function FingerprintSpoke({ fp, size = 28, className = "", title }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;
  const n = RAX.length;
  const pts = RAX.map((axis, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const v = Math.max(0, Math.min(1, fp[axis] ?? 0));
    const x = cx + Math.cos(angle) * r * v;
    const y = cy + Math.sin(angle) * r * v;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const guide = RAX.map((_axis, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <polygon points={guide} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth={0.75} />
      <polygon points={pts} fill="currentColor" fillOpacity={0.25} stroke="currentColor" strokeOpacity={0.9} strokeWidth={1} />
    </svg>
  );
}
