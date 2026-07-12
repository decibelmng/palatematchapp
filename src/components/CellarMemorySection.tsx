import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CanonBadge } from "@/components/CanonBadge";
import { NemesisBadge } from "@/components/NemesisBadge";
import type { CellarMatch } from "@/lib/cellar-memory";
import type { Recommendation } from "@/lib/recommender";


type Props = {
  matches: CellarMatch[];
  /** scannedIndex -> engine prediction for Tier 2 vintage-specific score */
  predictionsByIndex: Map<number, Recommendation>;
};

export function CellarMemorySection({ matches, predictionsByIndex }: Props) {
  const [open, setOpen] = useState(true);
  if (matches.length === 0) return null;

  const anyLoved = matches.some(
    (m) => (m.tier === 1 ? m.stars : m.avgStars) >= 4,
  );

  return (
    <section className="mt-6 rounded-lg border border-primary/30 bg-primary/[0.03]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-primary">From your cellar memory</p>
          <h2 className="font-serif text-lg mt-0.5">
            {anyLoved
              ? "You already love something on this list."
              : `${matches.length} wine${matches.length === 1 ? "" : "s"} you've rated`}
          </h2>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {matches.length} · {open ? "hide" : "show"}
        </span>
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {matches.map((m) => (
            <li key={`cellar-${m.scannedIndex}`} className="px-4 py-4">
              {m.tier === 1 ? (
                <Tier1Card m={m} />
              ) : (
                <Tier2Card m={m} pred={predictionsByIndex.get(m.scannedIndex) ?? null} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tier1Card({ m }: { m: Extract<CellarMatch, { tier: 1 }> }) {
  const w = m.scanned;
  const isWarn = m.stars <= 2 || m.isNemesis;
  const title = [w.producer, w.wine_name, w.vintage].filter(Boolean).join(" ") || "Rated wine";
  return (
    <div className={`flex items-start justify-between gap-3 ${isWarn ? "rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 -mx-1" : ""}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium leading-tight truncate">{title}</p>
          <span
            className="shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-primary/40 bg-primary/10 text-primary"
            title="You rated this"
          >
            You rated this
          </span>
          {m.isCanon && <CanonBadge />}
          {m.isNemesis && <NemesisBadge />}
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {[w.region, w.grape, w.price ?? null].filter(Boolean).join(" · ")}
        </p>
        {m.isNemesis ? (
          <p className="mt-1 text-[11px] text-destructive">
            Avoid ✕ — this is your Nemesis. You rated it {m.stars}★.
          </p>
        ) : isWarn ? (
          <p className="mt-1 text-[11px] text-destructive">
            You rated this {m.stars}★ — you might not want to re-order.
          </p>
        ) : null}
        <Link
          to="/rate"
          className="mt-1 inline-block text-[11px] text-primary underline underline-offset-2"
        >
          View in your ratings →
        </Link>
        {m.note && (
          <div className="mt-2 rounded border-l-2 border-primary/40 pl-2 py-0.5">
            <p className="text-[11px] italic text-muted-foreground leading-snug">"{m.note}"</p>
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        {m.isNemesis ? (
          <span className="font-serif text-destructive text-sm uppercase tracking-wider">Avoid ✕</span>
        ) : (
          <>
            <span className={`font-serif text-xl ${isWarn ? "text-destructive" : "text-primary"}`}>{m.stars}</span>
            <span className={`text-sm ${isWarn ? "text-destructive" : "text-primary"}`}>★</span>
          </>
        )}
        <p className="text-[10px] text-muted-foreground">your rating</p>
      </div>
    </div>
  );
}


function Tier2Card({
  m,
  pred,
}: {
  m: Extract<CellarMatch, { tier: 2 }>;
  pred: Recommendation | null;
}) {
  const w = m.scanned;
  const rep = m.repBottle;
  const knownVintage = m.ratedVintages[0];
  const listedVintage = w.vintage;
  const headline = [w.producer, w.wine_name, listedVintage].filter(Boolean).join(" ") || "Same cuvée";
  const roundedAvg = Math.round(m.avgStars * 10) / 10;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium leading-tight truncate">{headline}</p>
          <span
            className="shrink-0 inline-block rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wider border border-primary/40 bg-primary/10 text-primary"
            title="You've rated a different vintage of this wine"
          >
            You know this cuvée
          </span>
          {m.isCanon && <CanonBadge />}
          {m.isNemesis && <NemesisBadge />}

        </div>
        <p className="text-xs text-muted-foreground truncate">
          {[w.region, w.grape, w.price ?? null].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-1 text-[11px] text-foreground/85">
          You rated {knownVintage ? `the ${knownVintage}` : "another vintage"} → {roundedAvg}★
          {m.ratedVintages.length > 1 ? ` (across ${m.ratedVintages.length} vintages)` : ""}
        </p>
        {pred && listedVintage && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            This {listedVintage}: predicted {pred.predicted.toFixed(1)}★
          </p>
        )}
        {pred && !listedVintage && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            This bottling: predicted {pred.predicted.toFixed(1)}★
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <span className="font-serif text-primary text-xl">{roundedAvg}</span>
        <span className="text-primary text-sm">★</span>
        <p className="text-[10px] text-muted-foreground">your history</p>
        {pred && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            pred {pred.predicted.toFixed(1)}★
          </p>
        )}
      </div>
    </div>
  );
}
