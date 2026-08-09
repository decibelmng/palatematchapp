-- 1. Record HOW a scan's currency was determined, not just what it is.
--    Without this, a USD written from the fallback default is indistinguishable
--    from a USD read off a dollar sign on the list, and the venue-learning path
--    can't tell evidence from a guess.
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS currency_source text;

ALTER TABLE public.scans
  ADD CONSTRAINT scans_currency_source_chk
  CHECK (currency_source IS NULL OR currency_source IN ('override','text','restaurant','locale','default'));

COMMENT ON COLUMN public.scans.currency_source IS
  'Which rung of the currency ladder produced scans.currency: override | text | restaurant | locale | default. Only "text" is direct OCR evidence; only "text" may teach restaurants.currency.';

-- 2. Drop the vestigial predicted_stars column.
--    scan_offer_outcomes is an analysis-only view whose every meaningful
--    column is an aggregate of predicted_stars, so it cannot outlive the
--    column. Nothing in app code reads it; offered-vs-chosen accuracy is now
--    answered by prediction_outcomes JOIN scan_outcomes, which additionally
--    records rank, pipeline and palate_version.
DROP VIEW IF EXISTS public.scan_offer_outcomes;

--    A prediction is not a fact about a wine (data invariant 5): scores are
--    computed on read. prediction_outcomes now captures every prediction with
--    the palate_version, pipeline, rank and axis deltas that make it
--    interpretable, so this column was a strictly worse duplicate.
ALTER TABLE public.scan_wines
  DROP COLUMN IF EXISTS predicted_stars;
