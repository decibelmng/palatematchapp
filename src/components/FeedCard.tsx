// A friend's rating, compact. Three of these fit a 390px viewport.
//
//   name · rated · time                          their stars
//   wine title (never truncated, never repeating producer/vintage)
//   [ match line — only when it's actually a strong match ]
//   [ Rate it ]  [bookmark]
//
// Prediction runs the shared `recommend()` engine — read-only. No writes.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { recommend, type BottleFp, type RatedFp, type WineType } from "@/lib/recommender";
import { fpOf } from "@/lib/predict-core";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import {
  reasonForPrediction, calibrationPct, calibrationBand, confidenceCopy, relativeTime,
} from "@/lib/feed-reason";
import type { FeedItem } from "@/lib/feed.functions";
import { displayNameFor, initialsFor } from "@/lib/user-display";
import { FeedCardShell, WineLine, MatchLine, RateItButton, WishlistIconButton } from "./feed/primitives";

/** Above this, the match is worth calling out. Below it, it's noise. */
const CALLOUT_FLOOR = 4.0;

function StarsInline({ n }: { n: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${n} stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={12}
          strokeWidth={1.5}
          className={i <= n ? "fill-primary text-primary" : "text-muted-foreground/40"}
        />
      ))}
    </div>
  );
}

export function FeedCard({ item }: { item: FeedItem }) {
  const { friend, bottle } = item;

  const { data: viewerRatings } = useRatings();
  const viewerRatedIds = useMemo(
    () => (viewerRatings ?? []).map((r) => r.bottle_id),
    [viewerRatings],
  );
  const { data: viewerBottles } = useBottlesByIds(viewerRatedIds);

  const bType: WineType = (() => {
    const t = (bottle.type ?? "red").toLowerCase();
    if (t === "white" || t === "sparkling" || t === "rose" || t === "dessert") return t;
    return "red";
  })();

  const ratedSameType: RatedFp[] = useMemo(() => {
    if (!viewerRatings || !viewerBottles) return [];
    const out: RatedFp[] = [];
    for (const b of viewerBottles) {
      if (bottleType(b) !== bType) continue;
      const r = viewerRatings.find((x) => x.bottle_id === b.id);
      if (!r) continue;
      out.push({
        id: b.id, name: b.name, producer: b.producer, region: b.region,
        type: bottleType(b), fp: bottleToFp(b), stars: r.stars,
      });
    }
    return out;
  }, [viewerRatings, viewerBottles, bType]);

  const band = calibrationBand(calibrationPct(ratedSameType.length));

  // Only score a calibrated bottle. fpOf omits axes it can't read, so an
  // unread wine is never mistaken for a middling one.
  const bottleCalibrated =
    bottle.fp_fresh != null && bottle.fp_acid != null && bottle.fp_body != null;

  const scoring = useMemo(() => {
    if (!bottleCalibrated || ratedSameType.length < 2) return null;
    const cand: BottleFp = {
      id: bottle.id, name: bottle.name, producer: bottle.producer, region: bottle.region,
      type: bType, fp: fpOf(bottle),
    };
    const [rec] = recommend(ratedSameType, [cand]);
    if (!rec) return null;
    const reason = reasonForPrediction({
      candidateFp: cand.fp, type: bType, ratedSameType, predicted: rec.predicted,
    });
    return { predicted: rec.predicted, reason };
  }, [bottleCalibrated, bottle, bType, ratedSameType]);

  const strong = !!scoring && scoring.predicted >= CALLOUT_FLOOR;
  const headline = scoring ? confidenceCopy(band, scoring.predicted, bType).headline : null;

  return (
    <FeedCardShell accent="friend">
      <header className="flex items-center justify-between gap-2">
        <Link
          to="/u/$username"
          params={{ username: friend.username }}
          className="flex min-w-0 items-center gap-2"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-xs font-semibold">
            {initialsFor({ display_name: friend.display_name, username: friend.username })}
          </div>
          <span className="truncate text-xs">
            <span className="font-medium text-foreground">{displayNameFor(friend)}</span>
            <span className="text-muted-foreground"> rated · {relativeTime(item.created_at)}</span>
          </span>
        </Link>
        <StarsInline n={item.stars} />
      </header>

      <div className="mt-2">
        <WineLine bottle={bottle} />
      </div>

      {item.note && (
        <p className="mt-1.5 line-clamp-2 border-l-2 border-border pl-2 text-xs italic text-foreground/90">
          "{item.note}"
        </p>
      )}

      {strong && headline && (
        <MatchLine text={`${headline} — ${scoring!.reason}`} strong />
      )}

      <div className="mt-2 flex items-center gap-2">
        <RateItButton bottleId={bottle.id} />
        <WishlistIconButton bottleId={bottle.id} />
      </div>
    </FeedCardShell>
  );
}
