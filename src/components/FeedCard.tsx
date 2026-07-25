// Single friends-feed card.
//
//   friend avatar · name · "rated a wine" · time · palate archetype
//   friend's stars (small, top-right)
//   wine name (link) — grape · region · price band
//   ── predicted-for-you band ─────────────────
//   [ big score ]  headline  reason
//   [ amber caveat if thin ]
//   [ Want to try ] [ Rate it ]
//
// Prediction runs the shared `recommend()` engine — read-only. No writes.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Star, Bookmark, BookmarkCheck } from "lucide-react";
import { recommend, type BottleFp, type RatedFp, type WineType } from "@/lib/recommender";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { useAddToWishlist, useRemoveFromWishlist, useWishlistIds } from "@/hooks/use-wishlist";
import {
  reasonForPrediction, calibrationPct, calibrationBand, confidenceCopy, relativeTime,
} from "@/lib/feed-reason";
import type { FeedItem } from "@/lib/feed.functions";
import { displayNameFor, initialsFor as sharedInitials } from "@/lib/user-display";

function initialsFor(name: string | null | undefined, fallback: string): string {
  return sharedInitials({ display_name: name, username: fallback });
}

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

  // Viewer's rated wines → same-type anchor set.
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
  const paletteKind: "red" | "white" = (bType === "red" || bType === "dessert") ? "red" : "white";

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

  const nRatedThisType = ratedSameType.length;
  const calPct = calibrationPct(nRatedThisType);
  const band = calibrationBand(calPct);

  // Only score when the bottle is calibrated. C2 gives every scanned wine a
  // fingerprint; if a friend's wine is mid-flight (or was inserted flat), we
  // render "not scored yet" instead of a fake number.
  const bottleCalibrated =
    bottle.fp_fresh != null && bottle.fp_acid != null && bottle.fp_body != null;

  const scoring = useMemo(() => {
    if (!bottleCalibrated || ratedSameType.length < 2) return null;
    const cand: BottleFp = {
      id: bottle.id, name: bottle.name, producer: bottle.producer, region: bottle.region,
      type: bType,
      fp: {
        fresh: bottle.fp_fresh ?? 0.5, acid: bottle.fp_acid ?? 0.5,
        tannin: bottle.fp_tannin ?? 0.5, fruit_dark: bottle.fp_fruit_dark ?? 0.5,
        ripe: bottle.fp_ripe ?? 0.5, oak: bottle.fp_oak ?? 0.5,
        body: bottle.fp_body ?? 0.5, savory: bottle.fp_savory ?? 0.5,
      },
    };
    const [rec] = recommend(ratedSameType, [cand]);
    if (!rec) return null;
    const reason = reasonForPrediction({
      candidateFp: cand.fp, type: bType, ratedSameType, predicted: rec.predicted,
    });
    return { predicted: rec.predicted, reason };
  }, [bottleCalibrated, bottle, bType, ratedSameType]);

  const copy = scoring
    ? confidenceCopy(band, scoring.predicted, bType)
    : { headline: bottleCalibrated ? "Rate more to get a prediction" : "Not scored yet", caveat: null };

  const bandTone =
    scoring == null
      ? "bg-muted/40 text-muted-foreground"
      : scoring.predicted >= 4
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : scoring.predicted >= 3
      ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "bg-muted/60 text-foreground";

  const wishIds = useWishlistIds();
  const inWishlist = wishIds.has(bottle.id);
  const add = useAddToWishlist();
  const remove = useRemoveFromWishlist();
  const busy = add.isPending || remove.isPending;

  const paletteCode = paletteKind === "red" ? friend.palate_code_red : friend.palate_code_white;

  return (
    <article className="rounded-lg border border-border bg-card/60 p-4">
      <header className="flex items-start justify-between gap-2">
        <Link
          to="/u/$username"
          params={{ username: friend.username }}
          className="flex items-center gap-2 min-w-0"
        >
          <div className="h-9 w-9 rounded-full border border-border bg-muted/50 flex items-center justify-center text-xs font-semibold shrink-0">
            {initialsFor(friend.display_name, friend.username)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              {displayNameFor(friend)}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              rated a wine · {relativeTime(item.created_at)} · <span className="font-mono">{paletteCode}</span>
            </div>
          </div>
        </Link>
        <div className="shrink-0 text-right">
          <StarsInline n={item.stars} />
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
            their rating
          </div>
        </div>
      </header>

      <Link
        to="/wine/$id"
        params={{ id: bottle.id }}
        className="mt-3 block"
      >
        <div className="text-base font-medium leading-snug line-clamp-2">
          {bottle.producer ? `${bottle.producer} · ` : ""}{bottle.name}
          {bottle.vintage ? ` ${bottle.vintage}` : ""}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground truncate">
          {[bottle.grape, bottle.region, bottle.price_band].filter(Boolean).join(" · ")}
        </div>
      </Link>

      {item.note && (
        <p className="mt-2 text-sm text-foreground/90 italic border-l-2 border-border pl-3">
          "{item.note}"
        </p>
      )}

      <div className={`mt-3 rounded-md p-3 ${bandTone}`}>
        <div className="flex items-center gap-3">
          <div className="text-3xl font-serif tabular-nums leading-none">
            {scoring ? scoring.predicted.toFixed(1) : "—"}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">{copy.headline}</div>
            {scoring && (
              <div className="text-xs opacity-90 mt-0.5">{scoring.reason}</div>
            )}
          </div>
        </div>
        {copy.caveat && (
          <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            {copy.caveat}
          </div>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (inWishlist) remove.mutate({ bottle_id: bottle.id });
            else add.mutate({ bottle_id: bottle.id, source_context: "feed" });
          }}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
            inWishlist
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-background hover:bg-accent"
          }`}
        >
          {inWishlist ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
          {inWishlist ? "Saved" : "Want to try"}
        </button>
        <Link
          to="/wine/$id"
          params={{ id: bottle.id }}
          className="flex-1 inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium"
        >
          Rate it
        </Link>
      </div>
    </article>
  );
}
