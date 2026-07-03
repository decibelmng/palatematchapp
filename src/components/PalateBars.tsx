import type { AxisDef, LetterResult } from "@/lib/palate";

type Props = {
  axes: AxisDef[];
  letters: LetterResult[];
};

export function PalateBars({ axes, letters }: Props) {
  const byAxis = new Map(letters.map((l) => [l.axis, l]));

  return (
    <ul className="space-y-4">
      {axes.map((axisDef) => {
        const r = byAxis.get(axisDef.key);
        const resolved = r?.resolved ?? false;
        const isHigh = resolved && r!.letter === axisDef.high && !r!.bimodal;
        const isLow = resolved && r!.letter === axisDef.low && !r!.bimodal;
        const isN = resolved && r!.letter === "N";
        const rowOpacity = !resolved ? 0.5 : 1;

        const leftClass = isLow ? "text-primary font-medium" : "text-muted-foreground";
        const rightClass = isHigh ? "text-primary font-medium" : "text-muted-foreground";
        const centerClass = isN ? "text-primary" : "text-muted-foreground";

        return (
          <li key={axisDef.key} style={{ opacity: rowOpacity }}>
            <div className="flex items-baseline justify-between gap-2 text-[12px]">
              <span className={leftClass}>
                <span className="font-serif text-[14px] mr-1">{axisDef.low}</span>
                {axisDef.lowName}
              </span>
              <span className={`${centerClass} text-[11px] uppercase tracking-[0.15em]`}>
                {axisDef.label}
                {isN && <span className="font-serif normal-case tracking-normal"> · N</span>}
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
                  className="absolute w-3 h-3 rounded-full bg-primary"
                  style={{
                    left: `calc(${(r!.value * 100).toFixed(2)}% - 6px)`,
                    boxShadow: "0 0 0 2px var(--color-background)",
                  }}
                />
              )}
              {resolved && r!.bimodal && (
                <>
                  <div className="absolute w-2.5 h-2.5 rounded-full bg-primary"
                    style={{ left: "calc(25% - 5px)", boxShadow: "0 0 0 2px var(--color-background)" }} />
                  <div className="absolute w-2.5 h-2.5 rounded-full bg-primary"
                    style={{ left: "calc(75% - 5px)", boxShadow: "0 0 0 2px var(--color-background)" }} />
                </>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
