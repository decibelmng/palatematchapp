-- ============================================================
-- Tighten canon_wines_validate_tier: only fire when it actually
-- matters. Bare `replaced_at` updates (used by the cascade trigger
-- below) must not re-validate the rating.
-- ============================================================
DROP TRIGGER IF EXISTS canon_wines_validate_tier_trg ON public.canon_wines;

-- (Trigger may live under a different name in some environments; drop by owner+event too)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relname = 'canon_wines' AND NOT t.tgisinternal
      AND t.tgfoid = 'public.canon_wines_validate_tier'::regproc
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.canon_wines', r.tgname);
  END LOOP;
END $$;

CREATE TRIGGER canon_wines_validate_tier_trg
BEFORE INSERT OR UPDATE OF tier, rating_id, bottle_id
ON public.canon_wines
FOR EACH ROW EXECUTE FUNCTION public.canon_wines_validate_tier();

-- ============================================================
-- palate_version bump respects a per-txn suppression flag.
-- ============================================================
CREATE OR REPLACE FUNCTION public.bump_palate_version_from_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
  suppress text;
BEGIN
  BEGIN
    suppress := current_setting('app.suppress_palate_bump', true);
  EXCEPTION WHEN OTHERS THEN
    suppress := NULL;
  END;
  IF suppress = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  uid := COALESCE(NEW.user_id, OLD.user_id);
  IF uid IS NOT NULL THEN
    UPDATE public.profiles
      SET palate_version = palate_version + 1
      WHERE id = uid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

-- ============================================================
-- Safety-net cascade: a benchmark cannot outlive its rating's
-- tier gate. Fires on any rating update/delete, regardless of
-- which code path made the change.
-- ============================================================
CREATE OR REPLACE FUNCTION public.ratings_cascade_benchmarks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_uid uuid;
  target_bid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_uid := OLD.user_id;
    target_bid := OLD.bottle_id;
    -- Rating gone → any active benchmark for this bottle is an orphan.
    UPDATE public.canon_wines
      SET replaced_at = now()
      WHERE user_id = target_uid
        AND bottle_id = target_bid
        AND replaced_at IS NULL;
    RETURN OLD;
  END IF;

  target_uid := NEW.user_id;
  target_bid := NEW.bottle_id;

  UPDATE public.canon_wines
    SET replaced_at = now()
    WHERE user_id = target_uid
      AND bottle_id = target_bid
      AND replaced_at IS NULL
      AND (
        (tier = 'canon'   AND NEW.stars < 5) OR
        (tier = 'nemesis' AND NEW.stars > 2)
      );
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.ratings_cascade_benchmarks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ratings_cascade_benchmarks() FROM anon;
REVOKE ALL ON FUNCTION public.ratings_cascade_benchmarks() FROM authenticated;

DROP TRIGGER IF EXISTS ratings_cascade_benchmarks_trg ON public.ratings;
CREATE TRIGGER ratings_cascade_benchmarks_trg
AFTER UPDATE OF stars OR DELETE
ON public.ratings
FOR EACH ROW EXECUTE FUNCTION public.ratings_cascade_benchmarks();

-- ============================================================
-- RPC: save_rating_with_cascade (atomic rating write + benchmark demote)
--   p_stars = NULL → delete rating.
-- ============================================================
CREATE OR REPLACE FUNCTION public.save_rating_with_cascade(
  p_bottle_id uuid,
  p_stars int
)
RETURNS TABLE (
  demoted_tier text,
  previous_stars int,
  palate_version int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_prev_stars int;
  v_demoted text := NULL;
  v_new_version int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_stars IS NOT NULL AND (p_stars < 1 OR p_stars > 5) THEN
    RAISE EXCEPTION 'stars must be 1..5 or null, got %', p_stars;
  END IF;

  -- Capture prior rating for undo.
  SELECT r.stars INTO v_prev_stars
    FROM public.ratings r
    WHERE r.user_id = uid AND r.bottle_id = p_bottle_id;

  -- Identify which (if any) benchmark tier will be affected.
  IF p_stars IS NULL THEN
    SELECT c.tier INTO v_demoted
      FROM public.canon_wines c
      WHERE c.user_id = uid AND c.bottle_id = p_bottle_id AND c.replaced_at IS NULL
      LIMIT 1;
  ELSE
    SELECT c.tier INTO v_demoted
      FROM public.canon_wines c
      WHERE c.user_id = uid AND c.bottle_id = p_bottle_id AND c.replaced_at IS NULL
        AND ( (c.tier = 'canon'   AND p_stars < 5)
           OR (c.tier = 'nemesis' AND p_stars > 2) )
      LIMIT 1;
  END IF;

  -- Suppress the ratings->palate_version trigger; we'll bump once at the end.
  PERFORM set_config('app.suppress_palate_bump', 'on', true);

  IF p_stars IS NULL THEN
    DELETE FROM public.ratings
      WHERE user_id = uid AND bottle_id = p_bottle_id;
  ELSE
    INSERT INTO public.ratings (user_id, bottle_id, stars)
      VALUES (uid, p_bottle_id, p_stars)
      ON CONFLICT (user_id, bottle_id) DO UPDATE SET stars = EXCLUDED.stars;
  END IF;
  -- The AFTER trigger `ratings_cascade_benchmarks_trg` runs here and demotes
  -- any orphaned active benchmark for (uid, p_bottle_id).

  PERFORM set_config('app.suppress_palate_bump', 'off', true);

  -- Single explicit bump for the whole operation.
  UPDATE public.profiles
    SET palate_version = palate_version + 1
    WHERE id = uid
    RETURNING palate_version INTO v_new_version;

  RETURN QUERY SELECT v_demoted, v_prev_stars, v_new_version;
END $$;

REVOKE ALL ON FUNCTION public.save_rating_with_cascade(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_rating_with_cascade(uuid, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_rating_with_cascade(uuid, int) TO authenticated;

-- ============================================================
-- RPC: restore_rating_and_benchmark (undo for the cascade)
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_rating_and_benchmark(
  p_bottle_id uuid,
  p_stars int,
  p_tier text
)
RETURNS TABLE (
  benchmark_id uuid,
  palate_version int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_rating_id uuid;
  v_region text;
  v_region_key text;
  v_wine_type text;
  v_excluded boolean;
  v_new_id uuid := NULL;
  v_new_version int;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_tier IS NOT NULL AND p_tier NOT IN ('canon','nemesis') THEN
    RAISE EXCEPTION 'tier must be canon or nemesis or null, got %', p_tier;
  END IF;
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'stars required for restore (1..5), got %', p_stars;
  END IF;
  IF p_tier = 'canon' AND p_stars < 5 THEN
    RAISE EXCEPTION 'Canon undo requires 5 stars (got %)', p_stars;
  END IF;
  IF p_tier = 'nemesis' AND p_stars > 2 THEN
    RAISE EXCEPTION 'Nemesis undo requires 1..2 stars (got %)', p_stars;
  END IF;

  PERFORM set_config('app.suppress_palate_bump', 'on', true);

  -- Restore rating first so cascade trigger sees a valid tier and does nothing.
  INSERT INTO public.ratings (user_id, bottle_id, stars)
    VALUES (uid, p_bottle_id, p_stars)
    ON CONFLICT (user_id, bottle_id) DO UPDATE SET stars = EXCLUDED.stars
    RETURNING id INTO v_rating_id;

  IF p_tier IS NOT NULL THEN
    SELECT b.excluded_from_recs, NULLIF(TRIM(b.region), ''), COALESCE(NULLIF(b.type, ''), 'red')
      INTO v_excluded, v_region, v_wine_type
      FROM public.bottles b
      WHERE b.id = p_bottle_id;

    IF v_region IS NULL THEN
      RAISE EXCEPTION 'Bottle has no region — cannot restore benchmark';
    END IF;
    IF v_excluded THEN
      RAISE EXCEPTION 'EXCLUDED_BOTTLE: cannot restore benchmark on an excluded bottle';
    END IF;

    v_region_key := lower(v_region);

    -- Vacate any active occupant of this slot (atomic swap).
    UPDATE public.canon_wines
      SET replaced_at = now()
      WHERE user_id = uid
        AND tier = p_tier
        AND wine_type = v_wine_type
        AND (region_key = v_region_key OR lower(region) = v_region_key)
        AND replaced_at IS NULL;

    INSERT INTO public.canon_wines
      (user_id, rating_id, bottle_id, region, region_key, wine_type, tier)
      VALUES (uid, v_rating_id, p_bottle_id, v_region, v_region_key, v_wine_type, p_tier)
      RETURNING id INTO v_new_id;
  END IF;

  PERFORM set_config('app.suppress_palate_bump', 'off', true);

  UPDATE public.profiles
    SET palate_version = palate_version + 1
    WHERE id = uid
    RETURNING palate_version INTO v_new_version;

  RETURN QUERY SELECT v_new_id, v_new_version;
END $$;

REVOKE ALL ON FUNCTION public.restore_rating_and_benchmark(uuid, int, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_rating_and_benchmark(uuid, int, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.restore_rating_and_benchmark(uuid, int, text) TO authenticated;