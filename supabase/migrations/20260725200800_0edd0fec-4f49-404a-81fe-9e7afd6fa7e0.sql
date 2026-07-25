
-- BEFORE INSERT trigger on bottles: auto-populate the immutable prior columns
-- from the fp_* values the caller supplies. Any caller-supplied prior values
-- are preserved (useful for backfills/imports); everything else is auto-derived.
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
  IF NEW.fp_fresh_prior      IS NULL THEN NEW.fp_fresh_prior      := NEW.fp_fresh;      END IF;
  IF NEW.fp_acid_prior       IS NULL THEN NEW.fp_acid_prior       := NEW.fp_acid;       END IF;
  IF NEW.fp_tannin_prior     IS NULL THEN NEW.fp_tannin_prior     := NEW.fp_tannin;     END IF;
  IF NEW.fp_fruit_dark_prior IS NULL THEN NEW.fp_fruit_dark_prior := NEW.fp_fruit_dark; END IF;
  IF NEW.fp_ripe_prior       IS NULL THEN NEW.fp_ripe_prior       := NEW.fp_ripe;       END IF;
  IF NEW.fp_oak_prior        IS NULL THEN NEW.fp_oak_prior        := NEW.fp_oak;        END IF;
  IF NEW.fp_body_prior       IS NULL THEN NEW.fp_body_prior       := NEW.fp_body;       END IF;
  IF NEW.fp_savory_prior     IS NULL THEN NEW.fp_savory_prior     := NEW.fp_savory;     END IF;

  IF NEW.fp_prior_precision IS NULL THEN
    SELECT stddev_pop(v) INTO sigma FROM (VALUES
      (NEW.fp_fresh::double precision),(NEW.fp_acid::double precision),
      (NEW.fp_tannin::double precision),(NEW.fp_fruit_dark::double precision),
      (NEW.fp_ripe::double precision),(NEW.fp_oak::double precision),
      (NEW.fp_body::double precision),(NEW.fp_savory::double precision)
    ) t(v);
    source_w := CASE WHEN coalesce(NEW.source,'') ILIKE '%LLM-derived calibrated%' THEN 2.0 ELSE 1.0 END;
    flat_w   := CASE WHEN sigma < 0.10 THEN 0.5 ELSE 1.0 END;
    NEW.fp_prior_precision := 4.0 * source_w * flat_w;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bottles_seed_prior_trg ON public.bottles;
CREATE TRIGGER bottles_seed_prior_trg
  BEFORE INSERT ON public.bottles
  FOR EACH ROW
  EXECUTE FUNCTION public.bottles_seed_prior();
