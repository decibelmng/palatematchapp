import { WineTypeBadge } from "@/components/WineTypeBadge";
import type { TopMatch } from "@/lib/top-matches";

function vintageLabel(vs: number[]): string | null {
  if (vs.length === 0) return null;
  if (vs.length === 1) return `${vs[0]}`;
  if (vs.length <= 3) return vs.join(", ");
  return `${vs[0]}–${vs[vs.length - 1]} (${vs.length} vintages)`;
}

/** Compact row for a personalized match — the same shape /pour and Home use. */
export function PourMatchRow({ match }: { match: TopMatch }) {
  const c = match.cuvee;
  const meta = [c.producer, c.region].filter(Boolean).join(" · ");
  const vl = vintageLabel(c.vintages);
  return (
    <li className="py-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <WineTypeBadge type={c.type} />
          <span className="shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-primary/40 bg-primary/10 text-primary">
            catalog
          </span>
        </div>
        <p className="font-medium leading-tight truncate mt-1">{c.name}</p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {meta}{vl ? <span className="text-muted-foreground/80"> · {vl}</span> : null}
        </p>
        {match.nearestCuvee && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            like your {match.nearestCuvee.stars.toFixed(1)}★{" "}
            <span className="text-foreground/80">{match.nearestCuvee.name}</span>
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <span className="font-serif text-primary text-xl">{match.predicted.toFixed(1)}</span>
        <span className="text-primary text-sm">★</span>
        {match.confidence < 0.35 && (
          <p className="mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-border bg-muted text-muted-foreground">
            low match data
          </p>
        )}
      </div>
    </li>
  );
}
