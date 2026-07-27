import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Star, X } from "lucide-react";
import { AuthGate } from "@/components/AuthGate";
import { useWishlist, useRemoveFromWishlist } from "@/hooks/use-wishlist";
import { useRatings, useBottlesByIds, bottleToFp, bottleType } from "@/hooks/use-palate-data";
import { recommend, type BottleFp, type RatedFp, type WineType } from "@/lib/recommender";
import type { WishlistItem } from "@/lib/wishlist.functions";

export const Route = createFileRoute("/wishlist")({
  head: () => ({
    meta: [
      { title: "Wishlist — Palate Match" },
      { name: "description", content: "Wines you've saved to try — each scored for your palate." },
      { property: "og:title", content: "Palate Match — Wishlist" },
      { property: "og:description", content: "Wines you've saved to try — each scored for your palate." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WishlistPage,
});

function WishlistPage() {
  return (
    <AuthGate>
      <WishlistContent />
    </AuthGate>
  );
}


type Row = WishlistItem & { predicted: number | null };

function toWineType(t: string | null): WineType {
  const s = (t ?? "red").toLowerCase();
  if (s === "white" || s === "sparkling" || s === "rose" || s === "dessert") return s;
  return "red";
}

function WishlistContent() {
  const wishlist = useWishlist();
  const remove = useRemoveFromWishlist();
  const { data: viewerRatings } = useRatings();
  const viewerRatedIds = useMemo(
    () => (viewerRatings ?? []).map((r) => r.bottle_id),
    [viewerRatings],
  );
  const { data: viewerBottles } = useBottlesByIds(viewerRatedIds);
  const [sort, setSort] = useState<"predicted" | "recent">("predicted");

  const scored: Row[] = useMemo(() => {
    const items = wishlist.data ?? [];
    if (!viewerRatings || !viewerBottles) {
      return items.map((it) => ({ ...it, predicted: null }));
    }
    // Bucket rated anchors by wine type once.
    const byType = new Map<WineType, RatedFp[]>();
    for (const b of viewerBottles) {
      const r = viewerRatings.find((x) => x.bottle_id === b.id);
      if (!r) continue;
      const t = bottleType(b);
      const arr = byType.get(t) ?? [];
      arr.push({
        id: b.id, name: b.name, producer: b.producer, region: b.region,
        type: t, fp: bottleToFp(b), stars: r.stars,
      });
      byType.set(t, arr);
    }
    return items.map((it) => {
      const t = toWineType(it.bottle.type);
      const anchors = byType.get(t) ?? [];
      const calibrated =
        it.bottle.fp_fresh != null && it.bottle.fp_acid != null && it.bottle.fp_body != null;
      if (!calibrated || anchors.length < 2) return { ...it, predicted: null };
      const cand: BottleFp = {
        id: it.bottle.id, name: it.bottle.name, producer: it.bottle.producer, region: it.bottle.region,
        type: t,
        fp: {
          fresh: it.bottle.fp_fresh ?? 0.5, acid: it.bottle.fp_acid ?? 0.5,
          tannin: it.bottle.fp_tannin ?? 0.5, fruit_dark: it.bottle.fp_fruit_dark ?? 0.5,
          ripe: it.bottle.fp_ripe ?? 0.5, oak: it.bottle.fp_oak ?? 0.5,
          body: it.bottle.fp_body ?? 0.5, savory: it.bottle.fp_savory ?? 0.5,
        },
      };
      const [rec] = recommend(anchors, [cand]);
      return { ...it, predicted: rec?.predicted ?? null };
    });
  }, [wishlist.data, viewerRatings, viewerBottles]);

  const sorted = useMemo(() => {
    const rows = [...scored];
    if (sort === "predicted") {
      rows.sort((a, b) => (b.predicted ?? -1) - (a.predicted ?? -1));
    }
    return rows;
  }, [scored, sort]);

  return (
    <div className="pt-5 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-serif">Wishlist</h1>
        <div className="flex gap-1 text-xs">
          <button
            onClick={() => setSort("predicted")}
            className={`px-2 py-1 rounded-md border ${sort === "predicted" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
          >
            Best for me
          </button>
          <button
            onClick={() => setSort("recent")}
            className={`px-2 py-1 rounded-md border ${sort === "recent" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
          >
            Recent
          </button>
        </div>
      </div>

      {wishlist.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <p className="text-sm text-foreground">Your wishlist is empty.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Save wines from your friends' feed to remember them here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((row) => (
            <div key={row.id} className="rounded-lg border border-border bg-card p-3 flex items-center gap-3">
              <div className="w-12 text-center">
                <div className="text-2xl font-serif tabular-nums leading-none">
                  {row.predicted != null ? row.predicted.toFixed(1) : "—"}
                </div>
                <div className="text-meta uppercase tracking-label text-muted-foreground mt-1">
                  for you
                </div>
              </div>
              <Link
                to="/wine/$id"
                params={{ id: row.bottle.id }}
                className="flex-1 min-w-0"
              >
                <div className="text-sm font-medium leading-snug line-clamp-2">
                  {row.bottle.producer ? `${row.bottle.producer} · ` : ""}{row.bottle.name}
                  {row.bottle.vintage ? ` ${row.bottle.vintage}` : ""}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {[row.bottle.grape, row.bottle.region, row.bottle.price_band].filter(Boolean).join(" · ")}
                </div>
              </Link>
              <Link
                to="/wine/$id"
                params={{ id: row.bottle.id }}
                aria-label="Rate"
                className="min-h-11 min-w-11 flex items-center justify-center rounded-md text-primary hover:bg-primary/10"
              >
                <Star size={18} strokeWidth={2} />
              </Link>
              <button
                type="button"
                aria-label="Remove from wishlist"
                onClick={() => remove.mutate({ bottle_id: row.bottle.id })}
                className="min-h-11 min-w-11 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
