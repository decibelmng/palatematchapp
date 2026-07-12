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
    UPDATE public.canon_wines cw
      SET replaced_at = now()
      WHERE cw.user_id = uid AND cw.bottle_id = p_bottle_id AND cw.tier = p_tier AND cw.replaced_at IS NULL
      RETURNING cw.id INTO v_replaced_id;

    UPDATE public.profiles p
      SET palate_version = p.palate_version + 1
      WHERE p.id = uid
      RETURNING p.palate_version INTO v_new_version;

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

  UPDATE public.canon_wines cw
    SET replaced_at = now()
    WHERE cw.user_id = uid
      AND cw.tier = p_tier
      AND cw.wine_type = v_wine_type
      AND (cw.region_key = v_region_key OR lower(cw.region) = v_region_key)
      AND cw.replaced_at IS NULL
    RETURNING cw.id INTO v_replaced_id;

  INSERT INTO public.canon_wines (user_id, rating_id, bottle_id, region, wine_type, tier)
    VALUES (uid, v_rating_id, p_bottle_id, v_region, v_wine_type, p_tier)
    RETURNING id INTO v_new_id;

  UPDATE public.profiles p
    SET palate_version = p.palate_version + 1
    WHERE p.id = uid
    RETURNING p.palate_version INTO v_new_version;

  RETURN QUERY SELECT v_new_id, v_replaced_id, v_new_version;
END $function$;