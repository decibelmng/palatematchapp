-- ============================================================
-- B2: profiles.palate_version
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS palate_version integer NOT NULL DEFAULT 0;

-- Backfill: give existing profiles a non-zero starting value so any cached
-- client-side value from before this migration is guaranteed stale.
UPDATE public.profiles
  SET palate_version = COALESCE(n_rated, 0) + 1
  WHERE palate_version = 0;

-- ============================================================
-- B2: bump palate_version whenever ratings change
-- ============================================================
CREATE OR REPLACE FUNCTION public.bump_palate_version_from_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  uid := COALESCE(NEW.user_id, OLD.user_id);
  IF uid IS NOT NULL THEN
    UPDATE public.profiles
      SET palate_version = palate_version + 1
      WHERE id = uid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS ratings_bump_palate_version ON public.ratings;
CREATE TRIGGER ratings_bump_palate_version
AFTER INSERT OR UPDATE OF stars OR DELETE ON public.ratings
FOR EACH ROW EXECUTE FUNCTION public.bump_palate_version_from_rating();

-- ============================================================
-- B1: set_benchmark RPC (atomic promote/demote/swap)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_benchmark(
  p_bottle_id uuid,
  p_tier text,
  p_action text
)
RETURNS TABLE (
  benchmark_id uuid,
  replaced_id uuid,
  palate_version integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_rating_id uuid;
  v_stars int;
  v_region text;
  v_region_key text;
  v_wine_type text;
  v_excluded boolean;
  v_new_id uuid;
  v_replaced_id uuid;
  v_new_version int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_tier NOT IN ('canon','nemesis') THEN
    RAISE EXCEPTION 'set_benchmark: tier must be canon or nemesis, got %', p_tier;
  END IF;

  IF p_action NOT IN ('promote','demote','demote-on-rating') THEN
    RAISE EXCEPTION 'set_benchmark: action must be promote, demote, or demote-on-rating, got %', p_action;
  END IF;

  ------------------------------------------------------------------
  -- DEMOTE (single row, by bottle+tier+user)
  ------------------------------------------------------------------
  IF p_action IN ('demote','demote-on-rating') THEN
    UPDATE public.canon_wines
      SET replaced_at = now()
      WHERE user_id = uid
        AND bottle_id = p_bottle_id
        AND tier = p_tier
        AND replaced_at IS NULL
      RETURNING id INTO v_replaced_id;

    UPDATE public.profiles
      SET palate_version = palate_version + 1
      WHERE id = uid
      RETURNING palate_version INTO v_new_version;

    RETURN QUERY SELECT NULL::uuid, v_replaced_id, v_new_version;
    RETURN;
  END IF;

  ------------------------------------------------------------------
  -- PROMOTE (with atomic swap of any active same-scope benchmark)
  ------------------------------------------------------------------
  SELECT b.excluded_from_recs, NULLIF(TRIM(b.region), '')
    INTO v_excluded, v_region
    FROM public.bottles b
    WHERE b.id = p_bottle_id;

  IF v_region IS NULL THEN
    RAISE EXCEPTION 'Bottle has no region — cannot promote to %', p_tier;
  END IF;

  IF v_excluded THEN
    RAISE EXCEPTION 'EXCLUDED_BOTTLE: Barrel samples can''t be benchmarks — crown the finished wine instead.';
  END IF;

  -- Resolve rating + star gate
  SELECT r.id, r.stars INTO v_rating_id, v_stars
    FROM public.ratings r
    WHERE r.user_id = uid AND r.bottle_id = p_bottle_id;

  IF v_rating_id IS NULL THEN
    RAISE EXCEPTION 'Rate this bottle before promoting it to %', p_tier;
  END IF;

  IF p_tier = 'canon' AND v_stars < 5 THEN
    RAISE EXCEPTION 'Only 5-star ratings can become a Canon (got % stars)', v_stars;
  END IF;
  IF p_tier = 'nemesis' AND v_stars > 2 THEN
    RAISE EXCEPTION 'Only 1-2 star ratings can become a Nemesis (got % stars)', v_stars;
  END IF;

  v_region_key := lower(v_region);

  -- Wine type via existing bottle type (fall back to raw type; canon_wines
  -- stores the same normalization used at insert-time today).
  SELECT COALESCE(NULLIF(b.type, ''), 'red') INTO v_wine_type
    FROM public.bottles b WHERE b.id = p_bottle_id;

  -- Demote any active same-scope benchmark of this tier
  UPDATE public.canon_wines
    SET replaced_at = now()
    WHERE user_id = uid
      AND tier = p_tier
      AND wine_type = v_wine_type
      AND (region_key = v_region_key OR lower(region) = v_region_key)
      AND replaced_at IS NULL
    RETURNING id INTO v_replaced_id;

  INSERT INTO public.canon_wines
    (user_id, rating_id, bottle_id, region, region_key, wine_type, tier)
    VALUES (uid, v_rating_id, p_bottle_id, v_region, v_region_key, v_wine_type, p_tier)
    RETURNING id INTO v_new_id;

  UPDATE public.profiles
    SET palate_version = palate_version + 1
    WHERE id = uid
    RETURNING palate_version INTO v_new_version;

  RETURN QUERY SELECT v_new_id, v_replaced_id, v_new_version;
END $$;

GRANT EXECUTE ON FUNCTION public.set_benchmark(uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.set_benchmark(uuid, text, text) FROM anon;