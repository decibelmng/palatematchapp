
-- Give priors a placeholder default so the generated Insert TS type marks
-- them optional. The BEFORE INSERT trigger below overwrites these
-- unconditionally, so the default value never survives into a real row.
ALTER TABLE public.bottles
  ALTER COLUMN fp_fresh_prior      SET DEFAULT 0.5,
  ALTER COLUMN fp_acid_prior       SET DEFAULT 0.5,
  ALTER COLUMN fp_tannin_prior     SET DEFAULT 0.5,
  ALTER COLUMN fp_fruit_dark_prior SET DEFAULT 0.5,
  ALTER COLUMN fp_ripe_prior       SET DEFAULT 0.5,
  ALTER COLUMN fp_oak_prior        SET DEFAULT 0.5,
  ALTER COLUMN fp_body_prior       SET DEFAULT 0.5,
  ALTER COLUMN fp_savory_prior     SET DEFAULT 0.5,
  ALTER COLUMN fp_prior_precision  SET DEFAULT 4.0;

-- Trigger: on INSERT, priors are ALWAYS derived from fp_* (immutable-from-birth).
-- On UPDATE, priors are frozen and cannot be changed by callers (only the
-- recompute path — which never writes priors — may touch them).
CREATE OR REPLACE FUNCTION public.bottles_seed_prior()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  sigma double precision;
  source_w real;
  flat_w real;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.fp_fresh_prior      := NEW.fp_fresh;
    NEW.fp_acid_prior       := NEW.fp_acid;
    NEW.fp_tannin_prior     := NEW.fp_tannin;
    NEW.fp_fruit_dark_prior := NEW.fp_fruit_dark;
    NEW.fp_ripe_prior       := NEW.fp_ripe;
    NEW.fp_oak_prior        := NEW.fp_oak;
    NEW.fp_body_prior       := NEW.fp_body;
    NEW.fp_savory_prior     := NEW.fp_savory;

    SELECT stddev_pop(v) INTO sigma FROM (VALUES
      (NEW.fp_fresh::double precision),(NEW.fp_acid::double precision),
      (NEW.fp_tannin::double precision),(NEW.fp_fruit_dark::double precision),
      (NEW.fp_ripe::double precision),(NEW.fp_oak::double precision),
      (NEW.fp_body::double precision),(NEW.fp_savory::double precision)
    ) t(v);
    source_w := CASE WHEN coalesce(NEW.source,'') ILIKE '%LLM-derived calibrated%' THEN 2.0 ELSE 1.0 END;
    flat_w   := CASE WHEN sigma < 0.10 THEN 0.5 ELSE 1.0 END;
    NEW.fp_prior_precision := 4.0 * source_w * flat_w;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Freeze priors: reject any attempt to modify them from the caller side.
    -- (The recompute job in admin_fp_recompute_bottle only writes fp_* / ax_*,
    -- never the *_prior columns, so it is unaffected.)
    NEW.fp_fresh_prior      := OLD.fp_fresh_prior;
    NEW.fp_acid_prior       := OLD.fp_acid_prior;
    NEW.fp_tannin_prior     := OLD.fp_tannin_prior;
    NEW.fp_fruit_dark_prior := OLD.fp_fruit_dark_prior;
    NEW.fp_ripe_prior       := OLD.fp_ripe_prior;
    NEW.fp_oak_prior        := OLD.fp_oak_prior;
    NEW.fp_body_prior       := OLD.fp_body_prior;
    NEW.fp_savory_prior     := OLD.fp_savory_prior;
    NEW.fp_prior_precision  := OLD.fp_prior_precision;
    RETURN NEW;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bottles_seed_prior_trg ON public.bottles;
CREATE TRIGGER bottles_seed_prior_trg
  BEFORE INSERT OR UPDATE ON public.bottles
  FOR EACH ROW
  EXECUTE FUNCTION public.bottles_seed_prior();
