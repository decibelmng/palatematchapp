-- region_key is GENERATED ALWAYS AS (lower(btrim(region))); RPCs must not insert into it.
CREATE OR REPLACE FUNCTION public.set_benchmark(p_bottle_id uuid, p_tier text, p_action text)
 RETURNS TABLE(benchmark_id uuid, replaced_id uuid, palate_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  IF p_action IN ('demote','demote-on-rating') THEN
    UPDATE public.canon_wines
      SET replaced_at = now()
      WHERE user_id = uid AND bottle_id = p_bottle_id AND tier = p_tier AND replaced_at IS NULL
      RETURNING id INTO v_replaced_id;

    UPDATE public.profiles SET palate_version = palate_version + 1
      WHERE id = uid RETURNING palate_version INTO v_new_version;

    RETURN QUERY SELECT NULL::uuid, v_replaced_id, v_new_version;
    RETURN;
  END IF;

  SELECT b.excluded_from_recs, NULLIF(TRIM(b.region), '')
    INTO v_excluded, v_region
    FROM public.bottles b WHERE b.id = p_bottle_id;

  IF v_region IS NULL THEN
    RAISE EXCEPTION 'Bottle has no region — cannot promote to %', p_tier;
  END IF;
  IF v_excluded THEN
    RAISE EXCEPTION 'EXCLUDED_BOTTLE: Barrel samples can''t be benchmarks — crown the finished wine instead.';
  END IF;

  SELECT r.id, r.stars INTO v_rating_id, v_stars
    FROM public.ratings r WHERE r.user_id = uid AND r.bottle_id = p_bottle_id;

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
  SELECT COALESCE(NULLIF(b.type, ''), 'red') INTO v_wine_type
    FROM public.bottles b WHERE b.id = p_bottle_id;

  UPDATE public.canon_wines
    SET replaced_at = now()
    WHERE user_id = uid
      AND tier = p_tier
      AND wine_type = v_wine_type
      AND (region_key = v_region_key OR lower(region) = v_region_key)
      AND replaced_at IS NULL
    RETURNING id INTO v_replaced_id;

  -- region_key is a generated column; do NOT insert it.
  INSERT INTO public.canon_wines (user_id, rating_id, bottle_id, region, wine_type, tier)
    VALUES (uid, v_rating_id, p_bottle_id, v_region, v_wine_type, p_tier)
    RETURNING id INTO v_new_id;

  UPDATE public.profiles SET palate_version = palate_version + 1
    WHERE id = uid RETURNING palate_version INTO v_new_version;

  RETURN QUERY SELECT v_new_id, v_replaced_id, v_new_version;
END $function$;

CREATE OR REPLACE FUNCTION public.restore_rating_and_benchmark(p_bottle_id uuid, p_stars integer, p_tier text, p_predicted double precision DEFAULT NULL::double precision)
 RETURNS TABLE(benchmark_id uuid, palate_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_rating_id uuid;
  v_region text;
  v_region_key text;
  v_wine_type text;
  v_excluded boolean;
  v_calibrated boolean;
  v_new_id uuid := NULL;
  v_new_version int;
  v_delta double precision;
  v_had_dispute boolean;
  v_now_dispute boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
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

  INSERT INTO public.ratings (user_id, bottle_id, stars)
    VALUES (uid, p_bottle_id, p_stars)
    ON CONFLICT (user_id, bottle_id) DO UPDATE SET stars = EXCLUDED.stars
    RETURNING id INTO v_rating_id;

  IF p_tier IS NOT NULL THEN
    SELECT b.excluded_from_recs, NULLIF(TRIM(b.region), ''), COALESCE(NULLIF(b.type, ''), 'red'),
           (b.fp_fresh IS NOT NULL)
      INTO v_excluded, v_region, v_wine_type, v_calibrated
      FROM public.bottles b WHERE b.id = p_bottle_id;

    IF v_region IS NULL THEN RAISE EXCEPTION 'Bottle has no region — cannot restore benchmark'; END IF;
    IF v_excluded THEN RAISE EXCEPTION 'EXCLUDED_BOTTLE: cannot restore benchmark on an excluded bottle'; END IF;

    v_region_key := lower(v_region);

    UPDATE public.canon_wines
      SET replaced_at = now()
      WHERE user_id = uid
        AND tier = p_tier
        AND wine_type = v_wine_type
        AND (region_key = v_region_key OR lower(region) = v_region_key)
        AND replaced_at IS NULL;

    -- region_key is generated; omit from INSERT.
    INSERT INTO public.canon_wines (user_id, rating_id, bottle_id, region, wine_type, tier)
      VALUES (uid, v_rating_id, p_bottle_id, v_region, v_wine_type, p_tier)
      RETURNING id INTO v_new_id;
  ELSE
    SELECT b.excluded_from_recs, (b.fp_fresh IS NOT NULL)
      INTO v_excluded, v_calibrated
      FROM public.bottles b WHERE b.id = p_bottle_id;
  END IF;

  PERFORM set_config('app.suppress_palate_bump', 'off', true);

  SELECT EXISTS (SELECT 1 FROM public.fp_disputes WHERE user_id = uid AND bottle_id = p_bottle_id) INTO v_had_dispute;

  v_now_dispute := false;
  IF p_predicted IS NOT NULL
     AND coalesce(v_excluded, true) = false
     AND coalesce(v_calibrated, false) = true THEN
    v_delta := abs(p_stars::double precision - p_predicted);
    IF v_delta >= 2.5 THEN
      v_now_dispute := true;
      INSERT INTO public.fp_disputes (user_id, bottle_id, stars, predicted, delta)
        VALUES (uid, p_bottle_id, p_stars, p_predicted, v_delta)
        ON CONFLICT (user_id, bottle_id)
        DO UPDATE SET stars = EXCLUDED.stars, predicted = EXCLUDED.predicted, delta = EXCLUDED.delta;
    END IF;
  END IF;

  IF v_had_dispute AND NOT v_now_dispute THEN
    DELETE FROM public.fp_disputes WHERE user_id = uid AND bottle_id = p_bottle_id;
    UPDATE public.bottles SET fp_dispute_count = greatest(fp_dispute_count - 1, 0) WHERE id = p_bottle_id;
  ELSIF v_now_dispute AND NOT v_had_dispute THEN
    UPDATE public.bottles SET fp_dispute_count = fp_dispute_count + 1 WHERE id = p_bottle_id;
  END IF;

  UPDATE public.profiles p SET palate_version = p.palate_version + 1
    WHERE p.id = uid RETURNING p.palate_version INTO v_new_version;

  RETURN QUERY SELECT v_new_id, v_new_version;
END $function$;