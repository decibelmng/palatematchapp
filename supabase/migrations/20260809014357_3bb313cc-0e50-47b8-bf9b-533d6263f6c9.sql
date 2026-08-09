CREATE OR REPLACE FUNCTION public.save_rating_with_cascade(
  p_bottle_id uuid,
  p_stars integer,
  p_predicted double precision DEFAULT NULL::double precision,
  p_omega jsonb DEFAULT NULL::jsonb,
  p_bandwidth double precision DEFAULT NULL::double precision,
  p_n_rated integer DEFAULT NULL::integer,
  p_source text DEFAULT 'other'::text,
  p_scan_id uuid DEFAULT NULL::uuid,
  p_scan_wine_id uuid DEFAULT NULL::uuid,
  p_predicted_rank integer DEFAULT NULL::integer,
  p_null_reason text DEFAULT NULL::text,
  p_neighbor_support integer DEFAULT NULL::integer,
  p_axis_deltas jsonb DEFAULT NULL::jsonb)
RETURNS TABLE(demoted_tier text, previous_stars integer, palate_version integer, outcome_id uuid, delta double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_prev_stars int;
  v_demoted text := NULL;
  v_new_version int;
  v_excluded boolean;
  v_calibrated boolean;
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
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_stars IS NOT NULL AND (p_stars < 1 OR p_stars > 5) THEN
    RAISE EXCEPTION 'stars must be 1..5 or null, got %', p_stars;
  END IF;

  SELECT r.stars INTO v_prev_stars
    FROM public.ratings r
    WHERE r.user_id = uid AND r.bottle_id = p_bottle_id;

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

  SELECT b.excluded_from_recs, (b.fp_fresh IS NOT NULL), b.fp_pipeline
    INTO v_excluded, v_calibrated, v_pipeline
    FROM public.bottles b WHERE b.id = p_bottle_id;

  SELECT count(*) INTO v_n_rated FROM public.ratings r WHERE r.user_id = uid;

  PERFORM set_config('app.suppress_palate_bump', 'on', true);
  IF p_stars IS NULL THEN
    DELETE FROM public.ratings WHERE user_id = uid AND bottle_id = p_bottle_id;
  ELSE
    INSERT INTO public.ratings (user_id, bottle_id, stars)
      VALUES (uid, p_bottle_id, p_stars)
      ON CONFLICT (user_id, bottle_id) DO UPDATE SET stars = EXCLUDED.stars;
  END IF;
  PERFORM set_config('app.suppress_palate_bump', 'off', true);

  IF p_stars IS NOT NULL THEN
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
      source, scan_id, scan_wine_id, fp_pipeline, predicted_rank, null_reason,
      neighbor_support, axis_deltas
    )
    SELECT
      uid, p_bottle_id, p_stars, p_predicted,
      CASE WHEN p_predicted IS NOT NULL
        THEN p_stars::double precision - p_predicted END,
      p_omega, p_bandwidth,
      coalesce(p_n_rated, greatest(v_n_rated - 1, 0)),
      pr.palate_version,
      coalesce(p_source, 'other'), p_scan_id, p_scan_wine_id,
      coalesce(v_pipeline, 'unknown'), p_predicted_rank,
      CASE WHEN p_predicted IS NULL THEN v_null_reason END,
      p_neighbor_support, p_axis_deltas
    FROM public.profiles pr WHERE pr.id = uid
    RETURNING prediction_outcomes.id, prediction_outcomes.delta
      INTO v_outcome_id, v_signed_delta;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.fp_disputes
    WHERE user_id = uid AND bottle_id = p_bottle_id
  ) INTO v_had_dispute;

  v_now_dispute := false;
  IF p_stars IS NOT NULL
     AND p_predicted IS NOT NULL
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
        DO UPDATE SET stars = EXCLUDED.stars,
                      predicted = EXCLUDED.predicted,
                      delta = EXCLUDED.delta,
                      note = EXCLUDED.note;
    END IF;
  END IF;

  IF v_had_dispute AND NOT v_now_dispute THEN
    DELETE FROM public.fp_disputes WHERE user_id = uid AND bottle_id = p_bottle_id;
    UPDATE public.bottles
      SET fp_dispute_count = greatest(fp_dispute_count - 1, 0)
      WHERE id = p_bottle_id;
  ELSIF v_now_dispute AND NOT v_had_dispute THEN
    UPDATE public.bottles
      SET fp_dispute_count = fp_dispute_count + 1
      WHERE id = p_bottle_id;
  END IF;

  UPDATE public.profiles p
    SET palate_version = p.palate_version + 1
    WHERE p.id = uid
    RETURNING p.palate_version INTO v_new_version;

  RETURN QUERY SELECT v_demoted, v_prev_stars, v_new_version, v_outcome_id, v_signed_delta;
END
$function$;