-- 1) Auto-heal trigger: keep ax_* in lockstep with the fp_* invariant.
--    (ax_sweet is LLM-derived directly, not mirrored from any fp_.)
CREATE OR REPLACE FUNCTION public.bottles_enforce_ax_mapping()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only apply the invariant when the fp_ side actually carries a value.
  IF NEW.fp_body     IS NOT NULL THEN NEW.ax_body       := NEW.fp_body;   END IF;
  IF NEW.fp_tannin   IS NOT NULL THEN NEW.ax_tannin     := NEW.fp_tannin; END IF;
  IF NEW.fp_acid     IS NOT NULL THEN NEW.ax_acidity    := NEW.fp_acid;   END IF;
  IF NEW.fp_savory   IS NOT NULL THEN NEW.ax_fruit_char := NEW.fp_savory; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bottles_enforce_ax_mapping_trg ON public.bottles;
CREATE TRIGGER bottles_enforce_ax_mapping_trg
BEFORE INSERT OR UPDATE ON public.bottles
FOR EACH ROW EXECUTE FUNCTION public.bottles_enforce_ax_mapping();

-- 2) Drop DEFAULT 0.5 on every ax_/fp_ column. NOT NULL preserved so
--    any caller that forgets a value now fails loudly.
ALTER TABLE public.bottles
  ALTER COLUMN ax_body       DROP DEFAULT,
  ALTER COLUMN ax_fruit_char DROP DEFAULT,
  ALTER COLUMN ax_tannin     DROP DEFAULT,
  ALTER COLUMN ax_acidity    DROP DEFAULT,
  ALTER COLUMN ax_sweet      DROP DEFAULT,
  ALTER COLUMN fp_fresh      DROP DEFAULT,
  ALTER COLUMN fp_acid       DROP DEFAULT,
  ALTER COLUMN fp_tannin     DROP DEFAULT,
  ALTER COLUMN fp_fruit_dark DROP DEFAULT,
  ALTER COLUMN fp_ripe       DROP DEFAULT,
  ALTER COLUMN fp_oak        DROP DEFAULT,
  ALTER COLUMN fp_body       DROP DEFAULT,
  ALTER COLUMN fp_savory     DROP DEFAULT,
  ALTER COLUMN fp_fresh_prior      DROP DEFAULT,
  ALTER COLUMN fp_acid_prior       DROP DEFAULT,
  ALTER COLUMN fp_tannin_prior     DROP DEFAULT,
  ALTER COLUMN fp_fruit_dark_prior DROP DEFAULT,
  ALTER COLUMN fp_ripe_prior       DROP DEFAULT,
  ALTER COLUMN fp_oak_prior        DROP DEFAULT,
  ALTER COLUMN fp_body_prior       DROP DEFAULT,
  ALTER COLUMN fp_savory_prior     DROP DEFAULT;