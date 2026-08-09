-- ============================================================================
-- Catalog re-fingerprint, pre-swap preparation.
--
-- Three coercions are removed here. Each one silently converted "the reviewer
-- did not discuss this" into a confident numeric claim:
--
--   1. NOT NULL on fp_* forced 0.5-style fabrication for unread axes.
--   2. NOT NULL on the generated ax_* mirrors propagated that fabrication.
--   3. bottles_sync_fp_vec coalesced NULL -> 0, which is not neutral: it is the
--      extreme low end of every axis, so an unread wine would be pulled to a
--      corner of the ANN space it has no claim to.
-- ============================================================================

-- 1 + 2. Nullability. The generated ax_* columns must be relaxed too: a
-- generated column inherits its value from fp_*, so a NOT NULL on the mirror
-- re-imposes the constraint we just dropped on the source.
ALTER TABLE public.bottles
  ALTER COLUMN fp_fresh      DROP NOT NULL,
  ALTER COLUMN fp_acid       DROP NOT NULL,
  ALTER COLUMN fp_tannin     DROP NOT NULL,
  ALTER COLUMN fp_fruit_dark DROP NOT NULL,
  ALTER COLUMN fp_ripe       DROP NOT NULL,
  ALTER COLUMN fp_oak        DROP NOT NULL,
  ALTER COLUMN fp_body       DROP NOT NULL,
  ALTER COLUMN fp_savory     DROP NOT NULL,
  ALTER COLUMN ax_acidity    DROP NOT NULL,
  ALTER COLUMN ax_body       DROP NOT NULL,
  ALTER COLUMN ax_tannin     DROP NOT NULL,
  ALTER COLUMN ax_fruit_char DROP NOT NULL;

-- 3. fp_vec is an ANN RECALL PREFILTER ONLY. It must stay dense, so it is built
-- from the fp_*_prior columns, which are NOT NULL by construction (the typicity
-- baseline every row carries). Exact scoring reads the nullable fp_* columns and
-- skips absent axes; nothing may score off this vector.
CREATE OR REPLACE FUNCTION public.bottles_sync_fp_vec()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.fp_vec IS NULL
     OR NEW.fp_fresh_prior      IS DISTINCT FROM OLD.fp_fresh_prior
     OR NEW.fp_acid_prior       IS DISTINCT FROM OLD.fp_acid_prior
     OR NEW.fp_tannin_prior     IS DISTINCT FROM OLD.fp_tannin_prior
     OR NEW.fp_fruit_dark_prior IS DISTINCT FROM OLD.fp_fruit_dark_prior
     OR NEW.fp_ripe_prior       IS DISTINCT FROM OLD.fp_ripe_prior
     OR NEW.fp_oak_prior        IS DISTINCT FROM OLD.fp_oak_prior
     OR NEW.fp_body_prior       IS DISTINCT FROM OLD.fp_body_prior
     OR NEW.fp_savory_prior     IS DISTINCT FROM OLD.fp_savory_prior
  THEN
    -- No coalesce: the *_prior columns are NOT NULL, so the vector is dense by
    -- construction rather than dense by substitution.
    NEW.fp_vec := ARRAY[
      NEW.fp_fresh_prior,
      NEW.fp_acid_prior,
      NEW.fp_tannin_prior,
      NEW.fp_fruit_dark_prior,
      NEW.fp_ripe_prior,
      NEW.fp_oak_prior,
      NEW.fp_body_prior,
      NEW.fp_savory_prior
    ]::extensions.vector;
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.bottles_sync_fp_vec() IS
  'Builds fp_vec from the dense fp_*_prior baseline. fp_vec is an ANN recall prefilter only; exact scoring reads the nullable fp_* columns and skips absent axes. Never coalesce a NULL fp_* to 0 here - 0 is an extreme, not a neutral.';

-- Backfill the vector for every existing row under the new definition.
UPDATE public.bottles SET fp_vec = ARRAY[
  fp_fresh_prior, fp_acid_prior, fp_tannin_prior, fp_fruit_dark_prior,
  fp_ripe_prior, fp_oak_prior, fp_body_prior, fp_savory_prior
]::extensions.vector;

-- ============================================================================
-- Shadow columns for the atomic swap.
--
-- Mixed calibration is worse than uniformly wrong calibration: a distance
-- between a re-scored wine and an un-rescored one is an artifact of which batch
-- it landed in. So v3 is written here, validated across the full catalog, and
-- promoted in one transaction.
-- ============================================================================
ALTER TABLE public.bottles
  ADD COLUMN IF NOT EXISTS fp_fresh_v3      real,
  ADD COLUMN IF NOT EXISTS fp_acid_v3       real,
  ADD COLUMN IF NOT EXISTS fp_tannin_v3     real,
  ADD COLUMN IF NOT EXISTS fp_fruit_dark_v3 real,
  ADD COLUMN IF NOT EXISTS fp_ripe_v3       real,
  ADD COLUMN IF NOT EXISTS fp_oak_v3        real,
  ADD COLUMN IF NOT EXISTS fp_body_v3       real,
  ADD COLUMN IF NOT EXISTS fp_savory_v3     real,
  ADD COLUMN IF NOT EXISTS fp_v3_scored_at  timestamptz,
  ADD COLUMN IF NOT EXISTS fp_v3_job_id     uuid REFERENCES public.catalog_jobs(id),
  ADD COLUMN IF NOT EXISTS fp_v3_axes_read  smallint;

COMMENT ON COLUMN public.bottles.fp_v3_axes_read IS
  'How many of the 8 axes the wine''s note actually addressed. Drives the honesty of the confidence label: a wine read on 3 axes is a weaker reading than one read on 7, and must not be presented as equal.';

CREATE INDEX IF NOT EXISTS bottles_fp_v3_pending_idx
  ON public.bottles (id) WHERE fp_v3_scored_at IS NULL;