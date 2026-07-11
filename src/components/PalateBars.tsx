import { useEffect, useState } from "react";
import type { AxisDef, LetterResult } from "@/lib/palate";

type Props = {
  axes: AxisDef[];
  letters: LetterResult[];
};

export function PalateBars({ axes, letters }: Props) {
  const byAxis = new Map(letters.map((l) => [l.axis, l]));
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <ul className="space-y-5">
      {axes.map((axisDef, rowIdx) => {
        const r = byAxis.get(axisDef.key);
        const resolved = r?.resolved ?? false;
        const isHigh = resolved && r!.letter === axisDef.high && !r!.bimodal;
        const isLow = resolved && r!.letter === axisDef.low && !r!.bimodal;
        const isN = resolved && r!.letter === "N";
        const isX = resolved && r!.bimodal;
        const rowOpacity = !resolved ? 0.5 : 1;
        const delay = `${rowIdx * 60}ms`;

        const leftClass = isLow || isX ? "text-primary font-medium" : "text-muted-foreground";
        const rightClass = isHigh || isX ? "text-primary font-medium" : "text-muted-foreground";
        const centerClass = isN || isX ? "text-primary" : "text-muted-foreground";

        return (
          <li key={axisDef.key} style={{ opacity: rowOpacity }}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className={leftClass}>
                <span className="font-serif text-[14px] mr-1">{axisDef.low}</span>
                {axisDef.lowName}
              </span>
              <span
                className={`${centerClass} text-[10px] uppercase`}
                style={{ letterSpacing: "0.22em" }}
                title={isX ? "loves both poles" : undefined}
              >
                {axisDef.label}
                {isN && <span className="font-serif normal-case tracking-normal"> · N</span>}
                {isX && <span className="font-serif normal-case tracking-normal"> · X</span>}
              </span>
              <span className={rightClass}>
                {axisDef.highName}
                <span className="font-serif text-[14px] ml-1">{axisDef.high}</span>
              </span>
            </div>
            <div className="mt-2 relative h-3 flex items-center">
              <div className="absolute inset-x-0 h-1 rounded-full bg-muted" />
              {resolved && r!.value !== null && !r!.bimodal && (
                <div
                  className="absolute w-3 h-3 rounded-full bg-primary transition-[left] duration-[450ms] ease-out motion-reduce:transition-none"
                  style={{
                    left: mounted ? `calc(${(r!.value * 100).toFixed(2)}% - 6px)` : "-6px",
                    transitionDelay: delay,
                    boxShadow: "0 0 0 2px var(--color-background)",
                  }}
                />
              )}
              {resolved && r!.bimodal && (
                <div
                  className="absolute h-2 rounded-full bg-primary transition-[left,width] duration-[450ms] ease-out motion-reduce:transition-none"
                  style={{
                    left: mounted ? "25%" : "50%",
                    width: mounted ? "50%" : "0%",
                    opacity: 0.18,
                    transitionDelay: delay,
                  }}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
