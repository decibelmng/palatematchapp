DROP FUNCTION IF EXISTS public.restore_rating_and_benchmark(uuid, integer, text, double precision);

CREATE OR REPLACE FUNCTION public.restore_rating_and_benchmark(
  p_bottle_id uuid,
  p_stars integer,
  p_tier text,
  p_predicted double precision DEFAULT NULL::double precision,
  p_omega jsonb DEFAULT NULL::jsonb,
  p_bandwidth double precision DEFAULT NULL::double precision,
  p_n_rated integer DEFAULT NULL::integer,
  p_null_reason text DEFAULT NULL::text,
  p_neighbor_support integer DEFAULT NULL::integer,
  p_axis_deltas jsonb DEFAULT NULL::jsonb
)
 RETURNS TABLE(benchmark_id uuid, palate_version integer, outcome_id uuid, delta double precision)
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
  v_note text;
  v_pipeline text;
  v_null_reason text;
  v_n_rated int;
  v_outcome_id uuid := NULL;
  v_signed_delta double precision := NULL;
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
           (b.fp_fresh IS NOT NULL), b.fp_pipeline
      INTO v_excluded, v_region, v_wine_type, v_calibrated, v_pipeline
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

    INSERT INTO public.canon_wines (user_id, rating_id, bottle_id, region, wine_type, tier)
      VALUES (uid, v_rating_id, p_bottle_id, v_region, v_wine_type, p_tier)
      RETURNING id INTO v_new_id;
  ELSE
    SELECT b.excluded_from_recs, (b.fp_fresh IS NOT NULL), b.fp_pipeline
      INTO v_excluded, v_calibrated, v_pipeline
      FROM public.bottles b WHERE b.id = p_bottle_id;
  END IF;

  PERFORM set_config('app.suppress_palate_bump', 'off', true);

  -- ---- Accuracy log: append one row, exactly as the normal rating path does.
  -- A rating reached through Undo is a DELIBERATE one — the retracted stars are
  -- already in the log, so omitting the restore biased the record toward
  -- judgments the user changed their mind about. source='undo' keeps the two
  -- paths distinguishable; it is append-only, so both rows survive.
  SELECT count(*)::int INTO v_n_rated FROM public.ratings r WHERE r.user_id = uid;

  v_null_reason := p_null_reason;
  IF p_predicted IS NULL AND v_null_reason IS NULL THEN
    v_null_reason := CASE
      WHEN coalesce(v_calibrated, false) = false THEN 'uncalibrated_bottle'
      ELSE 'not_attempted'
    END;
  END IF;

  INSERT INTO public.prediction_outcomes (
    user_id, bottle_id, stars, predicted, delta,
    omega, bandwidth, n_rated_at_prediction, palate_version,
    source, fp_pipeline, null_reason, neighbor_support, axis_deltas
  )
  SELECT
    uid, p_bottle_id, p_stars, p_predicted,
    CASE WHEN p_predicted IS NOT NULL
      THEN p_stars::double precision - p_predicted END,
    p_omega, p_bandwidth,
    coalesce(p_n_rated, greatest(v_n_rated - 1, 0)),
    pr.palate_version,
    'undo',
    coalesce(v_pipeline, 'unknown'),
    CASE WHEN p_predicted IS NULL THEN v_null_reason END,
    p_neighbor_support, p_axis_deltas
  FROM public.profiles pr WHERE pr.id = uid
  RETURNING id, prediction_outcomes.delta INTO v_outcome_id, v_signed_delta;

  SELECT EXISTS (SELECT 1 FROM public.fp_disputes WHERE user_id = uid AND bottle_id = p_bottle_id) INTO v_had_dispute;

  v_now_dispute := false;
  IF p_predicted IS NOT NULL
     AND coalesce(v_excluded, true) = false
     AND coalesce(v_calibrated, false) = true THEN
    v_delta := abs(p_stars::double precision - p_predicted);
    IF v_delta >= 2.5 THEN
      v_now_dispute := true;
      SELECT r.note INTO v_note FROM public.ratings r
        WHERE r.user_id = uid AND r.bottle_id = p_bottle_id;
      INSERT INTO public.fp_disputes (user_id, bottle_id, stars, predicted, delta, note)
        VALUES (uid, p_bottle_id, p_stars, p_predicted, v_delta, v_note)
        ON CONFLICT (user_id, bottle_id)
        DO UPDATE SET stars = EXCLUDED.stars, predicted = EXCLUDED.predicted, delta = EXCLUDED.delta, note = EXCLUDED.note;
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

  RETURN QUERY SELECT v_new_id, v_new_version, v_outcome_id, v_signed_delta;
END $function$;