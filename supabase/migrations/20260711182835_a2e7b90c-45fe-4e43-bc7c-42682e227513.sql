CREATE OR REPLACE FUNCTION public.bottles_auto_exclude_samples()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Never un-flag: only auto-flag when currently false, and only based on text tokens.
  IF NEW.excluded_from_recs = false THEN
    IF (coalesce(NEW.name, '') || ' ' || coalesce(NEW.producer, ''))
       ~* '(barrel[- ]?sample|cask sample|tank sample|en primeur|futures)' THEN
      NEW.excluded_from_recs := true;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bottles_auto_exclude_samples_trg ON public.bottles;
CREATE TRIGGER bottles_auto_exclude_samples_trg
  BEFORE INSERT OR UPDATE OF name, producer, excluded_from_recs
  ON public.bottles
  FOR EACH ROW
  EXECUTE FUNCTION public.bottles_auto_exclude_samples();