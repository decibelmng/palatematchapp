type Props = {
  /** 0..5, can be fractional */
  value: number;
  size?: "sm" | "md";
  ariaLabel?: string;
};

/** Read-only stars matching StarTap's glyph, color, and sizing. Fractional-fill
 *  via a clipped overlay so 4.7★ renders as four full plus a partial glyph. */
export function StarDisplay({ value, size = "md", ariaLabel }: Props) {
  const px = size === "sm" ? "text-lg" : "text-2xl";
  const pct = Math.max(0, Math.min(5, value)) / 5 * 100;
  const stars = "★★★★★";
  return (
    <div
      className="relative inline-block leading-none select-none"
      role="img"
      aria-label={ariaLabel ?? `${value.toFixed(1)} out of 5 stars`}
    >
      <span className={`${px} text-muted-foreground/40 tracking-[0.15em]`}>{stars}</span>
      <span
        aria-hidden
        className={`${px} text-primary tracking-[0.15em] absolute inset-0 overflow-hidden whitespace-nowrap`}
        style={{ width: `${pct}%` }}
      >
        {stars}
      </span>
    </div>
  );
}
