-- Historical scans were written before currency_source existed. Their currency
-- can only be recovered from scan_wines.currency, which was itself resolved by
-- the same ladder without recording which rung fired — and on this data that
-- rung was almost always the USD default (1 scan of 79 carries a symbol).
-- Labelling those 'text' would fabricate evidence, and labelling them 'default'
-- would assert a rung we cannot actually verify. 'wines_backfill' says exactly
-- what is true: the currency is a recovered aggregate of unknown provenance,
-- and it is deliberately NOT eligible to teach restaurants.currency.
ALTER TABLE public.scans
  DROP CONSTRAINT IF EXISTS scans_currency_source_chk;

ALTER TABLE public.scans
  ADD CONSTRAINT scans_currency_source_chk
  CHECK (currency_source IS NULL OR currency_source IN
    ('override','text','restaurant','locale','default','wines_backfill'));

COMMENT ON COLUMN public.scans.currency_source IS
  'Which rung of the currency ladder produced scans.currency: override | text | restaurant | locale | default | wines_backfill. Only "text" is direct OCR evidence; only "text" may teach restaurants.currency. "wines_backfill" marks pre-instrumentation rows recovered from scan_wines.';
