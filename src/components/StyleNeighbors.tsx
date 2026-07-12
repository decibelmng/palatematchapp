// Style-neighbor section for a subject wine's detail page. The label + row
// treatment adapt to the subject's rating (discovery vs avoid-map); the query
// is the same in all three cases.

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { WineTypeBadge } from "@/components/WineTypeBadge";
import { CanonBadge } from "@/components/CanonBadge";
import { useStyleNeighbors, similarityChip } from "@/lib/style-neighbors";

type Props = {
  subjectBottleId: string;
  /** Subject's user rating (average across vintages if a cuvée). Drives the
   *  label + row-styling variant. Null when unrated. */
  subjectStars: number | null;
};

type Variant = "loved" | "neutral" | "disliked";
function variantFor(stars: number | null): Variant {
  if (stars === null) return "neutral";
  if (stars >= 4) return "loved";
  if (stars <= 2) return "disliked";
  return "neutral";
}

function sectionTitle(variant: Variant, stars: number | null): string {
  if (variant === "loved") return "More like this";
  if (variant === "disliked") return `Similar wines — heads up, you rated this ${stars}★`;
  return "Similar wines";
}

function vintageLabel(vs: number[]): string | null {
  if (vs.length === 0) return null;
  if (vs.length === 1) return `${vs[0]}`;
  if (vs.length <= 3) return vs.join(", ");
  return `${vs[0]}–${vs[vs.length - 1]} (${vs.length} vintages)`;
}

export function StyleNeighbors({ subjectBottleId, subjectStars }: Props) {
  const {
    subject,
    subjectType,
    unratedNeighbors,
    cellarNeighbors,
    loading,
    unavailableReason,
  } = useStyleNeighbors(subjectBottleId, 10, 25);

  const [showCellar, setShowCellar] = useState(false);

  if (loading) {
    return (
      <section className="mt-10">
        <p className="text-sm text-muted-foreground">Loading style neighbors…</p>
      </section>
    );
  }

  if (unavailableReason === "uncalibrated") {
    return (
      <section className="mt-10">
        <h2 className="font-serif text-xl">Style neighbors</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Style neighbors unavailable — this wine's fingerprint isn't calibrated yet.
        </p>
      </section>
    );
  }

  if (unavailableReason === "no-context" || !subject || !subjectType) {
    return (
      <section className="mt-10">
        <h2 className="font-serif text-xl">Style neighbors</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Rate a few more {subjectType ?? "wines"} of this type to unlock style neighbors.
        </p>
      </section>
    );
  }

  const variant = variantFor(subjectStars);
  const title = sectionTitle(variant, subjectStars);
  const isWarning = variant === "disliked";

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={`font-serif text-xl ${isWarning ? "text-destructive" : ""}`}>{title}</h2>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          by ω-distance
        </span>
      </div>

      {isWarning && (
        <p className="mt-1 text-[11px] uppercase tracking-wider text-destructive">
          Same-shape wines you may want to skip
        </p>
      )}

      {unratedNeighbors.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No unrated calibrated {subjectType}s in your candidate pool sit close enough.
        </p>
      ) : (
        <ul className={`mt-3 divide-y divide-border ${isWarning ? "opacity-90" : ""}`}>
          {unratedNeighbors.map((n) => (
            <li key={n.cuvee.cuvee}>
              <NeighborRow
                cuvee={n.cuvee}
                distance={n.distance}
                similarity={n.similarity}
                predicted={n.predicted}
                vetoed={n.vetoed}
                vetoNemesisName={n.vetoReason?.nemesis.name ?? null}
                vetoAxes={n.vetoReason?.drivingAxes ?? []}
                contested={n.contested}
                contestedNemesisName={n.contestedReason?.nemesis.name ?? null}
                nearestIsCanon={n.nearestIsCanon}
                type={subjectType}
                muted={isWarning}
              />
            </li>
          ))}
        </ul>
      )}

      {cellarNeighbors.length > 0 && (
        <div className="mt-6 border-t border-border/60 pt-4">
          <button
            type="button"
            onClick={() => setShowCellar((v) => !v)}
            className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
          >
            {showCellar ? "▾" : "▸"} From your cellar: closest wines you've rated ({cellarNeighbors.length})
          </button>
          {showCellar && (
            <ul className="mt-2 divide-y divide-border/60">
              {cellarNeighbors.map((c) => (
                <li key={c.cuvee.cuvee}>
                  <CellarRow
                    id={c.cuvee.id}
                    name={c.cuvee.name}
                    producer={c.cuvee.producer}
                    region={c.cuvee.region}
                    vintages={c.cuvee.vintages}
                    stars={c.cuvee.stars}
                    similarity={c.similarity}
                    type={subjectType}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function NeighborRow({
  cuvee, distance, similarity, predicted, vetoed, vetoNemesisName, vetoAxes,
  contested, contestedNemesisName,
  nearestIsCanon, type, muted,
}: {
  cuvee: { id: string; name: string; producer: string | null; region: string | null; vintages: number[] };
  distance: number;
  similarity: number;
  predicted: number;
  vetoed: boolean;
  vetoNemesisName: string | null;
  vetoAxes: string[];
  contested: boolean;
  contestedNemesisName: string | null;
  nearestIsCanon: boolean;
  type: "red" | "white" | "sparkling" | "rose" | "dessert";
  muted: boolean;
}) {
  const meta = [cuvee.producer, cuvee.region].filter(Boolean).join(" · ");
  const vl = vintageLabel(cuvee.vintages);
  const chip = similarityChip(similarity);

  return (
    <div className={`py-4 flex items-start justify-between gap-3 ${muted ? "opacity-90" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <WineTypeBadge type={type} />
          {vetoed && (
            <span className="shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-destructive/50 bg-destructive/10 text-destructive">
              avoid
            </span>
          )}
          {!vetoed && contested && contestedNemesisName && (
            <span
              className="shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              title="Inside your Nemesis's reach, but closer to a wine you love"
            >
              near your Nemesis {contestedNemesisName}
            </span>
          )}
          {!vetoed && nearestIsCanon && <CanonBadge size="sm" title="Nearest rated anchor is a Canon" />}
        </div>
        <Link
          to="/wine/$id"
          params={{ id: cuvee.id }}
          className={`block font-medium leading-tight truncate mt-1 hover:underline ${muted || vetoed ? "text-muted-foreground" : ""}`}
        >
          {cuvee.name}
        </Link>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {meta}{vl ? <span className="text-muted-foreground/80"> · {vl}</span> : null}
        </p>
        {vetoed && vetoNemesisName && (
          <p className="mt-1 text-[11px] text-destructive">
            Matches your Nemesis {vetoNemesisName}
            {vetoAxes.length > 0 ? ` — ${vetoAxes.join(", ")}` : ""}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        {vetoed ? (
          <span className="font-serif text-destructive text-sm uppercase tracking-wider">Avoid ✕</span>
        ) : (
          <>
            <span className={`font-serif text-xl ${muted ? "text-muted-foreground" : "text-primary"}`}>
              {predicted.toFixed(1)}
            </span>
            <span className={`text-sm ${muted ? "text-muted-foreground" : "text-primary"}`}>★</span>
            <p
              className="mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-border bg-muted text-muted-foreground"
              title={`ω-distance: ${distance.toFixed(3)}`}
            >
              {chip}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function CellarRow({
  id, name, producer, region, vintages, stars, similarity, type,
}: {
  id: string;
  name: string;
  producer: string | null;
  region: string | null;
  vintages: number[];
  stars: number;
  similarity: number;
  type: "red" | "white" | "sparkling" | "rose" | "dessert";
}) {
  const meta = [producer, region].filter(Boolean).join(" · ");
  const vl = vintageLabel(vintages);
  const chip = similarityChip(similarity);
  return (
    <div className="py-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <WineTypeBadge type={type} />
        </div>
        <Link
          to="/wine/$id"
          params={{ id }}
          className="block text-sm font-medium leading-tight truncate mt-1 hover:underline"
        >
          {name}
        </Link>
        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
          {meta}{vl ? <span className="text-muted-foreground/80"> · {vl}</span> : null}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span className="font-serif text-primary text-base">{stars.toFixed(1)}</span>
        <span className="text-primary text-xs">★</span>
        <p className="mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-border bg-muted text-muted-foreground">
          {chip}
        </p>
      </div>
    </div>
  );
}
