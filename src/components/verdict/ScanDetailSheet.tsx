import { useEffect } from "react";
import { toast } from "sonner";
import { friendlyError } from "@/lib/error-message";
import { useRate, useRatings } from "@/hooks/use-palate-data";
import { StarTap } from "@/components/StarTap";
import { FingerprintSpoke } from "@/components/FingerprintSpoke";
import type { ScanRow } from "./types";
import { priceLabel } from "./types";
import { verdictLine, becauseLine } from "./reason";
import { OrderedButton } from "./OrderedButton";

/**
 * Detail sheet — the ONLY place a decimal score is allowed to appear on
 * the verdict screen. Rating a wine you've drunk lives here too (not in
 * the Call or the rows). Rating has NO time gate: if you open a wine and
 * want to record it, do it. The push to rate is what's deferred to the
 * post-meal prompt in scan history, not the ability to rate.
 */
export function ScanDetailSheet({
  row, scannedAt, nearTie, onClose, scanId, rank,
  ordered, onOrdered, orderPending, canOrder,
}: {
  row: ScanRow | null;
  /** Secondary path for choice capture, for someone who tapped in first. */
  ordered?: boolean;
  onOrdered?: () => void;
  orderPending?: boolean;
  canOrder?: boolean;
  /** Scan this wine came from, recorded with any rating made here. */
  scanId?: string | null;
  /** 1 = this was the Call. */
  rank?: number | null;
  /** epoch ms of the scan; retained for prompt copy, not for gating rating */
  scannedAt: number | null;
  /**
   * One line for the enthusiast who taps in: another wine scored within 0.1 of
   * this one. Deliberately NOT a card on the decision surface — the point of
   * resolving the tie is that the person should not have to.
   */
  nearTie?: string | null;
  onClose: () => void;
}) {

  const { data: ratings } = useRatings();
  const rate = useRate();

  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [row, onClose]);

  if (!row) return null;
  const r = row.ranked;
  const bottleId = r.scanned.matched_bottle_id;
  const currentStars = bottleId ? (ratings?.find((x) => x.bottle_id === bottleId)?.stars ?? null) : null;
  const because = becauseLine(row);
  const verdict = verdictLine(r.predicted);

  // Rating is always available once we have a bottle to attach it to.
  const canRate = bottleId != null;
  const nowMs = Date.now();
  const isPostMeal = scannedAt != null && (nowMs - scannedAt) > 3 * 3600 * 1000;


  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Detail for ${r.bottle.name}`}>
      <button
        aria-label="Close detail"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 motion-safe:animate-in motion-safe:fade-in"
      />
      <div
        className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-(--surface) border-t border-border p-5 pb-8 motion-safe:animate-in motion-safe:slide-in-from-bottom max-h-[85vh] overflow-y-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border" aria-hidden />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-serif text-heading leading-tight text-foreground break-words">{r.bottle.name}</p>
            {r.bottle.region && <p className="mt-1 text-meta text-muted-foreground">{r.bottle.region}</p>}
          </div>
          <div className="shrink-0 text-right">
            {r.predicted > 0 ? (
              <>
                <span className="font-serif text-(--accent-color) text-3xl leading-none">{r.predicted.toFixed(1)}</span>
                <span className="text-(--accent-color) text-lg leading-none">★</span>
              </>
            ) : (
              <span className="text-meta text-muted-foreground">no score</span>
            )}
          </div>
        </div>
        {nearTie && (
          <p className="mt-1 text-meta text-muted-foreground">{nearTie}</p>
        )}

        <p className="mt-3 text-heading text-foreground leading-snug">{verdict}</p>
        <p className="mt-2 text-body text-muted-foreground">{because}</p>
        <p className="mt-3 text-sub">
          <span className="text-(--accent-color) font-medium">{priceLabel(row)}</span>
          <span className="ml-2 text-label uppercase tracking-label text-muted-foreground">
            {row.isCatalog ? "Catalog match" : "Estimated"}
          </span>
        </p>
        {row.verdict && (
          <span
            className={`mt-2 inline-block rounded-full px-2 py-0.5 text-label uppercase tracking-label border ${
              row.verdict.tone === "good"
                ? "border-(--good)/50 bg-(--good)/10 text-foreground"
                : row.verdict.tone === "warn"
                ? "border-[color-mix(in_oklab,var(--amber)_55%,transparent)] bg-[color-mix(in_oklab,var(--amber)_10%,transparent)] text-foreground"
                : "border-[color-mix(in_oklab,var(--crimson)_55%,transparent)] bg-[color-mix(in_oklab,var(--crimson)_12%,transparent)] text-foreground"
            }`}
          >
            {row.verdict.label}
          </span>
        )}
        {row.valueSentence && (
          <p className="mt-2 text-meta text-muted-foreground leading-snug">{row.valueSentence}</p>
        )}

        {canOrder && onOrdered && (
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-3">
            <span className="text-label uppercase tracking-label text-muted-foreground">
              {isPostMeal ? "Is this the one you ordered?" : "Ordering this one?"}
            </span>
            <OrderedButton
              ordered={!!ordered}
              disabled={orderPending}
              size="compact"
              wineName={r.bottle.name}
              onToggle={onOrdered}
            />
          </div>
        )}

        {canRate && (
          <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-3">
            <span className="text-label uppercase tracking-label text-muted-foreground">
              {currentStars != null ? "Your rating" : isPostMeal ? "Did you order it? Rate it." : "Rate it"}
            </span>

            <StarTap
              value={currentStars}
              size="md"
              onChange={(stars) => {
                if (stars == null || stars === currentStars) return;
                rate.mutate(
                  {
                    bottleId: bottleId!,
                    stars,
                    source: "scan_list",
                    scanId: scanId ?? null,
                    scanWineId: r.scanned.scan_wine_id ?? null,
                    predictedRank: rank ?? null,
                  },
                  {
                    onSuccess: () => toast.success(`Rated ${stars}★`),
                    onError: (e) => {
                      const msg = (e as any)?.message ?? (typeof e === "string" ? e : "Couldn't save rating");
                      if (!/canceled/i.test(msg)) toast.error(friendlyError(msg, "Couldn't save rating"));
                    },
                  },
                );
              }}
            />
          </div>
        )}

        <div className="mt-5 flex items-center gap-4">
          <FingerprintSpoke fp={r.bottle.fp} size={72} />
          <div className="min-w-0 text-meta text-muted-foreground">
            {r.nearest ? (
              <p>
                Closest to your <span className="text-foreground">{r.nearest.stars}★ {r.nearest.name}</span>
                {r.nearestIsCanon && <span className="ml-1 text-(--accent-color)">· Benchmark</span>}
              </p>
            ) : (
              <p>No close neighbor in your rated wines yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
