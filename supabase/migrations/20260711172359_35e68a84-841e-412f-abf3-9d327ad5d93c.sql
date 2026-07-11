
ALTER TABLE public.canon_wines ALTER COLUMN tier DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.canon_wines_validate_tier()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s int;
BEGIN
  IF NEW.tier IS NULL THEN
    RAISE EXCEPTION 'canon_wines.tier is required (canon or nemesis)';
  END IF;
  IF NEW.tier NOT IN ('canon','nemesis') THEN
    RAISE EXCEPTION 'canon_wines.tier must be canon or nemesis, got %', NEW.tier;
  END IF;
  SELECT stars INTO s FROM public.ratings WHERE id = NEW.rating_id;
  IF s IS NULL THEN
    RAISE EXCEPTION 'canon_wines.rating_id % has no matching rating', NEW.rating_id;
  END IF;
  IF NEW.tier = 'canon' AND s < 5 THEN
    RAISE EXCEPTION 'Only 5-star ratings can become a Canon (got % stars)', s;
  END IF;
  IF NEW.tier = 'nemesis' AND s > 2 THEN
    RAISE EXCEPTION 'Only 1-2 star ratings can become a Nemesis (got % stars)', s;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS canon_wines_validate_tier_trg ON public.canon_wines;
CREATE TRIGGER canon_wines_validate_tier_trg
  BEFORE INSERT OR UPDATE OF tier, rating_id ON public.canon_wines
  FOR EACH ROW EXECUTE FUNCTION public.canon_wines_validate_tier();
