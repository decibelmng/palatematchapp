import { useState } from "react";
import type { ScanRow } from "./types";
import { priceLabel } from "./types";
import { verdictLine, becauseLine } from "./reason";

type CallKind = "your-pick" | "closest-match" | "top-two";

export function TheCall({
  row, kind, onOpen,
}: {
  row: ScanRow;
  kind: CallKind;
  onOpen: () => void;
}) {
  const [confOpen, setConfOpen] = useState(false);
  const eyebrow =
    kind === "closest-match" ? "Closest match" :
    kind === "top-two" ? "Top two" : "Your pick";

  const price = priceLabel(row);
  const verdict = verdictLine(row.ranked.predicted);
  const because = becauseLine(row);
  const nearestCount = row.ranked.maxSimilarity >= 0.35 ? 3 : 0; // proxy — recommender doesn't expose neighbor count
  const confident = row.isCatalog && nearestCount >= 3;
  const confChip = confident ? "Confident" : "Estimated";
  const confExplain = confident
    ? "Matched to a wine in the catalog with several close neighbors in wines you've rated."
    : "The wine wasn't a clean catalog match, so its profile is inferred — treat the read as a strong guess.";

  const bottle = row.ranked.bottle;
  const region = bottle.region ?? null;
  const vintage = row.ranked.scanned.vintage ?? null;
  const producer = bottle.producer ?? null;

  const meta = [producer, region, vintage].filter(Boolean).join(" · ");

  const verdictTone = row.verdict;

  return (
    <div>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open details for ${bottle.name}`}
        className="scan-hero relative w-full text-left rounded-xl border border-[--accent-color] p-5 bg-[--surface] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--accent-color]"
        style={{ boxShadow: "0 0 0 1px var(--accent-color), 0 12px 40px -12px color-mix(in oklab, var(--accent-color) 40%, transparent)" }}
      >
        <p className="text-label uppercase tracking-label text-[--accent-color] font-medium">
          {eyebrow}
        </p>
        <p className="mt-3 font-serif text-title text-foreground break-words leading-tight">
          {bottle.name}
        </p>
        {meta && (
          <p className="mt-1 text-sub text-muted-foreground break-words">{meta}</p>
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
          {verdictTone && (
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-label uppercase tracking-label border ${
                verdictTone.tone === "good"
                  ? "border-[--good]/50 bg-[--good]/10 text-foreground"
                  : verdictTone.tone === "warn"
                  ? "border-[color-mix(in_oklab,var(--amber)_55%,transparent)] bg-[color-mix(in_oklab,var(--amber)_10%,transparent)] text-foreground"
                  : "border-[color-mix(in_oklab,var(--crimson)_55%,transparent)] bg-[color-mix(in_oklab,var(--crimson)_12%,transparent)] text-foreground"
              }`}
            >
              {verdictTone.label}
            </span>
          )}

          {row.greatValue && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[--good]/50 bg-[--good]/10 px-2 py-0.5 text-label uppercase tracking-label text-foreground">
              <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full bg-[--good]" />
              Value
            </span>
          )}
        </div>

        {row.valueSentence && (
          <p className="mt-2 text-meta text-muted-foreground leading-snug">{row.valueSentence}</p>
        )}
      </button>

      {/* Confidence chip sits OUTSIDE the Call button to avoid nested interactives */}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfOpen((v) => !v)}
          aria-expanded={confOpen}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-label uppercase tracking-label text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {confChip}
          <span aria-hidden>ⓘ</span>
        </button>
        {confOpen && (
          <p className="text-meta text-muted-foreground flex-1 min-w-0">{confExplain}</p>
        )}
      </div>
    </div>
  );
}
