import { useState, type ReactNode } from "react";
import { CanonBadge } from "@/components/CanonBadge";
import { FingerprintSpoke } from "@/components/FingerprintSpoke";
import type { Lane } from "@/lib/lanes";

type Props<T> = {
  lanes: Lane<T>[];
  renderRow: (item: T) => ReactNode;
  keyFor: (item: T) => string;
  /** Default rows visible per lane before "+n more". */
  initialPerLane?: number;
  /** Absolute cap when expanded. */
  expandedPerLane?: number;
};

export function LaneList<T>({
  lanes,
  renderRow,
  keyFor,
  initialPerLane = 3,
  expandedPerLane = 8,
}: Props<T>) {
  return (
    <div className="mt-3 space-y-6">
      {lanes.map((lane) => (
        <LaneBlock
          key={lane.clusterId}
          lane={lane}
          renderRow={renderRow}
          keyFor={keyFor}
          initialPerLane={initialPerLane}
          expandedPerLane={expandedPerLane}
        />
      ))}
    </div>
  );
}

function LaneBlock<T>({
  lane,
  renderRow,
  keyFor,
  initialPerLane,
  expandedPerLane,
}: {
  lane: Lane<T>;
  renderRow: (item: T) => ReactNode;
  keyFor: (item: T) => string;
  initialPerLane: number;
  expandedPerLane: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const cap = expanded ? expandedPerLane : initialPerLane;
  const visible = lane.members.slice(0, cap);
  const hidden = Math.max(0, Math.min(lane.members.length, expandedPerLane) - visible.length);

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="text-primary shrink-0 mt-0.5">
          <FingerprintSpoke fp={lane.canonFp} size={28} title={`${lane.canonName} fingerprint`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-serif text-base leading-tight">{lane.styleName}</h3>
            <CanonBadge size="sm" title={`Anchored by your Canon: ${lane.canonName}`} />
            {!lane.isStub && (
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {lane.members.length} match{lane.members.length === 1 ? "" : "es"}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
            via <span className="text-foreground/80">{lane.canonName}</span>
            {lane.canonRegion ? <> · {lane.canonRegion}</> : null}
            {lane.memberCanons.length > 1 && (
              <> · +{lane.memberCanons.length - 1} merged Canon{lane.memberCanons.length - 1 === 1 ? "" : "s"}</>
            )}
          </p>
        </div>
      </div>

      {lane.isStub ? (
        <p className="mt-2 rounded-md border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          No strong {lane.styleName.toLowerCase()} matches in this pool.
        </p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-border">
            {visible.map((m) => (
              <li key={keyFor(m.payload)}>{renderRow(m.payload)}</li>
            ))}
          </ul>
          {(hidden > 0 || (expanded && lane.members.length > initialPerLane)) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              {expanded
                ? "▴ Show fewer"
                : `▾ +${Math.min(hidden, expandedPerLane - visible.length)} more in this lane`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
