import { useState } from "react";
import type { ScanRow } from "./types";
import { priceLabel } from "./types";
import { verdictLine, becauseLine } from "./reason";
import { OrderedButton } from "./OrderedButton";
import { approxVintage, approxChipLabel, approxCaveat, approxSubline } from "./vintage";

/**
 * Eyebrow states — there are exactly two, and each renders the same thing:
 * ONE bottle, its verdict sentence, its reason, its price.
 *   "Your pick"      — the chosen bottle scores 4.0 or better.
 *   "Closest match"  — nothing on the list clears 4.0; this is the nearest.
 * Ties within 0.1★ are broken upstream in VerdictSurface, so no state ever
 * promises content this card does not render.
 */
type CallKind = "your-pick" | "closest-match";

export function TheCall({
  row, kind, onOpen, ordered, onOrdered, orderPending, canOrder,
}: {
  row: ScanRow;
  kind: CallKind;
  onOpen: () => void;
  /** Choice capture — one tap, no confirmation, undoable. */
  ordered?: boolean;
  onOrdered?: () => void;
  orderPending?: boolean;
  canOrder?: boolean;
}) {
  const [confOpen, setConfOpen] = useState(false);
  const [vintOpen, setVintOpen] = useState(false);
  const eyebrow = kind === "closest-match" ? "Closest match" : "Your pick";

  const price = priceLabel(row);
  const verdict = verdictLine(row.ranked.predicted);
  const because = becauseLine(row);
  // Confidence rests on two real signals — a clean catalog match and genuine
  // similarity to a wine you've rated. Don't invent a neighbour count the
  // recommender never computed (it exposes maxSimilarity, not how many).
  const estimated = isEstimated(row);
  const confident = row.isCatalog && row.ranked.maxSimilarity >= 0.35;
  // Three states, not two. "Estimated match" reads as a grade we gave the wine;
  // the true fact is about our catalog, so an unmatched line says so plainly.
  const confChip = estimated ? ESTIMATED_CHIP : confident ? "Confident match" : "Close match";
  const confExplain = estimated
    ? ESTIMATED_SENTENCE
    : confident
    ? "This wine is in our catalog and sits close to a bottle you've rated."
    : "This wine is in our catalog, but it sits some way from anything you've rated.";

  const bottle = row.ranked.bottle;
  const region = bottle.region ?? null;
  const vintage = row.ranked.scanned.vintage ?? null;
  const producer = bottle.producer ?? null;

  // A different vintage than the list showed is stated, never substituted:
  // a person can judge "scored off the 2013"; a silent swap they cannot. When
  // the year is approximate the meta line carries the year we ACTUALLY scored,
  // not the year on the list — otherwise the card claims a bottle it did not
  // read.
  const approx = approxVintage(row);

  const meta = [producer, region, approx ? null : vintage].filter(Boolean).join(" · ");


  return (
    <div
      className="scan-hero relative rounded-xl border border-(--accent-color) p-5 bg-(--surface)"
      style={{ boxShadow: "0 0 0 1px var(--accent-color), 0 12px 40px -12px color-mix(in oklab, var(--accent-color) 40%, transparent)" }}
    >
      {/* Full-card open affordance sits UNDER the content as an overlay button,
          so the confidence chip can live inside the card without nesting
          interactive elements. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open details for ${bottle.name}`}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent-color)"
      />

      <div className="relative z-10 pointer-events-none">
        <p className="text-label uppercase tracking-label text-(--accent-color) font-medium">
          {eyebrow}
        </p>
        <p className="mt-3 font-serif text-title text-foreground break-words leading-tight">
          {bottle.name}
        </p>
        {meta && (
          <p className="mt-1 text-sub text-muted-foreground break-words">{meta}</p>
        )}
        {approx && (
          <p className="mt-1 text-sub text-muted-foreground break-words">
            {approxSubline(approx)}
          </p>
        )}

        <p className="mt-4 text-heading text-foreground leading-snug">
          {verdict}
        </p>
        <p className="mt-2 text-body text-muted-foreground leading-relaxed">
          {because}
        </p>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          {row.ranked.vetoed && (
            <span className="pm-skip-badge">Skip</span>
          )}
          <span className="text-body text-foreground font-medium">{price}</span>

          {/* Exactly one value chip. The price-band mechanism ("bottom third on
              price") is not a verdict — it lives in the detail sheet. */}
          {row.greatValue && (
            <span className="inline-flex items-center gap-1 rounded-full border border-(--good)/50 bg-(--good)/10 px-2 py-0.5 text-label uppercase tracking-label text-foreground">
              <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-(--good)" />
              Good value
            </span>
          )}

          {/* Confidence qualifies the pick, so it belongs on the price row. */}
          <button
            type="button"
            onClick={() => setConfOpen((v) => !v)}
            aria-expanded={confOpen}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-label uppercase tracking-label text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {confChip}
            <span aria-hidden>ⓘ</span>
          </button>

          {/* Same weight as the confidence chip: which bottle we scored is a
              confidence claim, not a footnote. */}
          {approx && (
            <button
              type="button"
              onClick={() => setVintOpen((v) => !v)}
              aria-expanded={vintOpen}
              className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-label uppercase tracking-label text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {approxChipLabel(approx)}
              <span aria-hidden>ⓘ</span>
            </button>
          )}
        </div>

        {confOpen && (
          <p className="mt-2 text-meta text-muted-foreground leading-snug">{confExplain}</p>
        )}
        {vintOpen && approx && (
          <p className="mt-2 text-meta text-muted-foreground leading-snug">{approxCaveat(approx)}</p>
        )}

        {canOrder && onOrdered && (
          <div className="mt-4">
            <OrderedButton
              ordered={!!ordered}
              disabled={orderPending}
              wineName={bottle.name}
              onToggle={onOrdered}
            />
          </div>
        )}

        {row.valueSentence && (
          <p className="mt-2 text-meta text-muted-foreground leading-snug">{row.valueSentence}</p>
        )}
      </div>
    </div>
  );
}
