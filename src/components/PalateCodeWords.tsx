// The decoded words beneath a palate code.
//
// Three surfaces render the glyphs with no tap affordance — a public
// profile, the share card, and link previews — and slot 3 changes axis
// between colours (grip for reds, oak for whites). The words come from
// the same explainer tables the tap path uses, so the two can never
// disagree.

import type { PaletteType } from "@/lib/palate";
import { codePhrases, slotResolved } from "@/lib/palate-code-letters";

export function PalateCodeWords({
  type,
  code,
  className,
}: {
  type: PaletteType;
  code: string;
  className?: string;
}) {
  const phrases = codePhrases(type, code);
  return (
    <p className={`text-meta leading-snug text-muted-foreground ${className ?? ""}`}>
      {phrases.map((p, i) => (
        <span key={`${type}-w-${i}`}>
          {i > 0 && <span className="opacity-40"> · </span>}
          <span className={slotResolved(type, code, i) ? "text-foreground/80" : ""}>{p}</span>
        </span>
      ))}
    </p>
  );
}
