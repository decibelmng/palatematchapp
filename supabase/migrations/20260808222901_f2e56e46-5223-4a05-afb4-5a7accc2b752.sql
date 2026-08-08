-- 1) The two new measurement fields.
ALTER TABLE public.prediction_outcomes
  ADD COLUMN IF NOT EXISTS miss_attribution text,
  ADD COLUMN IF NOT EXISTS axis_deltas jsonb;

ALTER TABLE public.prediction_outcomes
  DROP CONSTRAINT IF EXISTS prediction_outcomes_miss_attribution_check;
ALTER TABLE public.prediction_outcomes
  ADD CONSTRAINT prediction_outcomes_miss_attribution_check
  CHECK (miss_attribution IS NULL OR miss_attribution IN ('fingerprint', 'palate'));

COMMENT ON COLUMN public.prediction_outcomes.miss_attribution IS
  'From the one person who tasted the wine, on |delta| >= 1.0 only. '
  '''fingerprint'' = not the style they expected (the wine is misdescribed; the model reasoned correctly from bad data -> re-score the wine). '
  '''palate'' = right style, just not for them (the description was accurate and we still mispredicted -> retune this user''s weights). '
  'Write-once: NULL -> value, never edited after.';

COMMENT ON COLUMN public.prediction_outcomes.axis_deltas IS
  'Signed per-axis difference between the candidate and the nearest 4+ star rated wine of the same colour, in omega-weighted space: '
  '{"axes":{"oak":+0.21,...},"anchor":{"id":..,"name":..,"stars":..},"weighted":true}. '
  'Makes a systematic miss readable: if every over-prediction shares a high positive oak delta, the model is over-tolerant of oak for this user.';

COMMENT ON TABLE public.prediction_outcomes IS
  'Append-only measurement log: what we predicted, what the person rated, and the model state that produced the number. '
  'miss_attribution is the ONLY field that may be written after insert, once, NULL -> value. '
  'WHAT THIS IS FOR, LATER (deliberately NOT implemented, in increasing order of risk): '
  '(a) Per-axis bias correction - if one user''s errors show consistent directional bias on an axis, shift that axis''s contribution for that user. Low risk, per-user, reversible. '
  '(b) Surprise weighting - ratings that contradicted a confident prediction weigh more in the ridge fit than ones that confirmed it. Medium risk: interacts with adaptive bandwidth and gamma sharpening. '
  '(c) Fingerprint flagging - a wine drawing large ''not the style I expected'' misses across MULTIPLE users is a catalog defect, not a palate defect; queue it for re-scoring. This is the one that scales, because it fixes the catalog for everyone rather than tuning one person''s weights, and it cannot run until multiple users exist. '
  'Nothing in scoring, weighting, or ranking reads this table.';

-- 2) Append-only, with one narrow exception: attribution may be set once.
CREATE OR REPLACE FUNCTION public.prediction_outcomes_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.miss_attribution IS NULL
     AND NEW.miss_attribution IS NOT NULL
     AND to_jsonb(NEW) - 'miss_attribution' = to_jsonb(OLD) - 'miss_attribution' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'prediction_outcomes is append-only (attempted %)', TG_OP
    USING ERRCODE = '42501';
END
$function$;

-- 3) Setter for the inline follow-up. Own rows only, big misses only, once.
CREATE OR REPLACE FUNCTION public.set_miss_attribution(
  p_outcome_id uuid,
  p_attribution text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_ok boolean := false;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_attribution NOT IN ('fingerprint', 'palate') THEN
    RAISE EXCEPTION 'attribution must be fingerprint or palate, got %', p_attribution;
  END IF;

  UPDATE public.prediction_outcomes o
    SET miss_attribution = p_attribution
    WHERE o.id = p_outcome_id
      AND o.user_id = uid
      AND o.miss_attribution IS NULL
      AND o.delta IS NOT NULL
      AND abs(o.delta) >= 1.0
    RETURNING true INTO v_ok;

  RETURN coalesce(v_ok, false);
END
$function$;

REVOKE ALL ON FUNCTION public.set_miss_attribution(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_miss_attribution(uuid, text) TO authenticated;

-- 4) Rating save: accept axis_deltas, and return the log row id so the UI can
--    attach an attribution to the rating it just made. Return type changes, so
--    the function is dropped and recreated.
DROP FUNCTION IF EXISTS public.save_rating_with_cascade(uuid, integer, double precision, jsonb, double precision, integer, text, uuid, uuid, integer, text, integer);

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
  p_axis_deltas jsonb DEFAULT NULL::jsonb
)
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

  -- Ratings BEFORE this one — the prediction was made against that state.
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

  -- ---- MEASUREMENT LOG: unconditional, and BEFORE the 2.5 check. ----
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
    RETURNING id, delta INTO v_outcome_id, v_signed_delta;
  END IF;

  -- ---- Dispute signal: unchanged, still gated on |delta| >= 2.5. ----
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

-- 5) Directional bias, readable per user per axis.
DROP VIEW IF EXISTS public.prediction_axis_bias;
CREATE VIEW public.prediction_axis_bias
WITH (security_invoker = on) AS
SELECT
  o.user_id,
  b.type                                              AS wine_type,
  o.fp_pipeline,
  ax.key                                              AS axis,
  count(*)                                            AS n,
  round(avg(o.delta)::numeric, 3)                     AS mean_signed_error,
  round(avg((ax.value #>> '{}')::double precision)::numeric, 3) AS mean_axis_delta,
  -- The claim that matters: does error move WITH this axis's difference?
  -- Positive => we over-predict wines that sit high on this axis for this user.
  round(corr(o.delta, (ax.value #>> '{}')::double precision)::numeric, 3) AS error_axis_corr,
  round(avg(o.delta) FILTER (WHERE (ax.value #>> '{}')::double precision > 0)::numeric, 3) AS mean_error_when_higher,
  round(avg(o.delta) FILTER (WHERE (ax.value #>> '{}')::double precision < 0)::numeric, 3) AS mean_error_when_lower,
  count(*) FILTER (WHERE o.miss_attribution = 'fingerprint') AS n_style_was_wrong,
  count(*) FILTER (WHERE o.miss_attribution = 'palate')      AS n_taste_was_wrong
FROM public.prediction_outcomes o
JOIN public.bottles b ON b.id = o.bottle_id
CROSS JOIN LATERAL jsonb_each(coalesce(o.axis_deltas -> 'axes', '{}'::jsonb)) AS ax(key, value)
WHERE o.delta IS NOT NULL
GROUP BY o.user_id, b.type, o.fp_pipeline, ax.key;

COMMENT ON VIEW public.prediction_axis_bias IS
  'Mean signed prediction error per axis, per user, per colour. Read error_axis_corr with n: '
  'a consistent positive value on one axis is a specific fixable claim (over-tolerant of that axis for this user), '
  'not "predictions are sometimes off". Diagnostic only — nothing in scoring reads it.';

GRANT SELECT ON public.prediction_axis_bias TO authenticated;