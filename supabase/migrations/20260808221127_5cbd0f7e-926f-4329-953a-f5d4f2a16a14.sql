-- ============================================================
-- prediction_outcomes — append-only prediction error log
-- ============================================================
-- Purpose: separate "the palate model is wrong" from "the fingerprint is
-- wrong". fp_pipeline is recorded per row because with a typicity-grid
-- catalog that ambiguity is present in every row we log.
-- Written UNCONDITIONALLY on every rating, before the fp_disputes >= 2.5
-- check. fp_disputes keeps its current job (the correction trigger).

CREATE TABLE public.prediction_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  bottle_id uuid NOT NULL REFERENCES public.bottles(id),
  -- Outcome
  stars int NOT NULL CHECK (stars BETWEEN 1 AND 5),
  predicted double precision,
  -- SIGNED: stars - predicted. Positive = liked it more than we said.
  -- Sign is the whole point; fp_disputes stores the absolute value.
  delta double precision,
  -- Model state at prediction time
  omega jsonb,
  bandwidth double precision,
  n_rated_at_prediction int,
  palate_version int,
  -- Provenance
  source text NOT NULL DEFAULT 'other'
    CHECK (source IN ('scan_list','scan_bottle','rate_screen','undo','somm','other')),
  scan_id uuid REFERENCES public.scans(id) ON DELETE SET NULL,
  scan_wine_id uuid REFERENCES public.scan_wines(id) ON DELETE SET NULL,
  -- The candidate bottle's pipeline AT PREDICTION TIME. Never backfilled from
  -- bottles later: a re-fingerprint must not rewrite history.
  fp_pipeline text NOT NULL DEFAULT 'unknown',
  -- Where this wine ranked in the scan it came from (1 = the Call). A 1.5 miss
  -- on rank 1 is a product failure; the same miss on rank 34 is not.
  predicted_rank int,
  -- Populated only when predicted IS NULL, so missingness is countable.
  null_reason text CHECK (null_reason IN (
    'uncalibrated_bottle','too_few_ratings','no_same_type_ratings','fetch_failed','not_attempted'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A row either has a prediction or a reason it doesn't.
  CONSTRAINT prediction_outcomes_null_accounted
    CHECK ((predicted IS NOT NULL AND delta IS NOT NULL) OR null_reason IS NOT NULL)
);

CREATE INDEX prediction_outcomes_user_created_idx
  ON public.prediction_outcomes (user_id, created_at DESC);
CREATE INDEX prediction_outcomes_bottle_idx
  ON public.prediction_outcomes (bottle_id);
CREATE INDEX prediction_outcomes_scan_idx
  ON public.prediction_outcomes (scan_id) WHERE scan_id IS NOT NULL;

GRANT SELECT, INSERT ON public.prediction_outcomes TO authenticated;
GRANT ALL ON public.prediction_outcomes TO service_role;

ALTER TABLE public.prediction_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insert own prediction outcomes"
  ON public.prediction_outcomes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "read own prediction outcomes"
  ON public.prediction_outcomes FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Append-only in the database, not just by policy omission. A measurement log
-- that can be quietly edited is not a measurement log.
CREATE OR REPLACE FUNCTION public.prediction_outcomes_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'prediction_outcomes is append-only (attempted %)', TG_OP
    USING ERRCODE = '42501';
END
$$;

CREATE TRIGGER prediction_outcomes_no_update
  BEFORE UPDATE ON public.prediction_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.prediction_outcomes_append_only();

CREATE TRIGGER prediction_outcomes_no_delete
  BEFORE DELETE ON public.prediction_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.prediction_outcomes_append_only();


-- ============================================================
-- View 1 — error aggregation
-- ============================================================
CREATE VIEW public.prediction_error_summary
WITH (security_invoker = on) AS
SELECT
  o.user_id,
  o.palate_version,
  b.type                                   AS wine_type,
  o.fp_pipeline,
  count(*)                                 AS n_logged,
  count(o.predicted)                       AS n_scored,
  count(*) - count(o.predicted)            AS n_unscored,
  round(avg(abs(o.delta))::numeric, 3)     AS mae,
  -- Signed mean: positive = we systematically under-rate what they enjoy.
  round(avg(o.delta)::numeric, 3)          AS mean_signed_error,
  round(stddev_pop(o.delta)::numeric, 3)   AS sd_error,
  round(max(abs(o.delta))::numeric, 3)     AS worst_miss,
  round((count(*) FILTER (WHERE abs(o.delta) <= 0.5))::numeric
        / nullif(count(o.predicted), 0), 3) AS within_half_star,
  round((count(*) FILTER (WHERE abs(o.delta) <= 1.0))::numeric
        / nullif(count(o.predicted), 0), 3) AS within_one_star,
  -- The Call vs the rest of the list.
  round(avg(abs(o.delta)) FILTER (WHERE o.predicted_rank = 1)::numeric, 3) AS mae_rank_1,
  round(avg(abs(o.delta)) FILTER (WHERE o.predicted_rank > 1)::numeric, 3) AS mae_rank_rest,
  min(o.created_at)                        AS first_logged_at,
  max(o.created_at)                        AS last_logged_at
FROM public.prediction_outcomes o
JOIN public.bottles b ON b.id = o.bottle_id
GROUP BY o.user_id, o.palate_version, b.type, o.fp_pipeline;

GRANT SELECT ON public.prediction_error_summary TO authenticated;
GRANT SELECT ON public.prediction_error_summary TO service_role;


-- ============================================================
-- View 2 — baseline comparison
-- ============================================================
-- The model is only interesting if it beats "guess this person's average for
-- this colour". Baseline error is computed from the SAME rated rows, so the
-- comparison is paired.
CREATE VIEW public.prediction_baseline_comparison
WITH (security_invoker = on) AS
WITH scored AS (
  SELECT o.user_id, o.stars, o.predicted, o.delta, b.type AS wine_type
  FROM public.prediction_outcomes o
  JOIN public.bottles b ON b.id = o.bottle_id
  WHERE o.predicted IS NOT NULL
),
means AS (
  SELECT user_id, wine_type, avg(stars)::double precision AS mean_stars
  FROM scored GROUP BY user_id, wine_type
)
SELECT
  s.user_id,
  s.wine_type,
  count(*)                                                     AS n_scored,
  round(avg(abs(s.delta))::numeric, 3)                         AS model_mae,
  round(avg(abs(s.stars - m.mean_stars))::numeric, 3)          AS baseline_mae,
  round((avg(abs(s.stars - m.mean_stars)) - avg(abs(s.delta)))::numeric, 3)
                                                               AS mae_improvement,
  CASE WHEN avg(abs(s.stars - m.mean_stars)) > 0
    THEN round((1 - avg(abs(s.delta)) / avg(abs(s.stars - m.mean_stars)))::numeric, 3)
  END                                                          AS skill_score,
  round(m.mean_stars::numeric, 2)                              AS baseline_prediction
FROM scored s
JOIN means m ON m.user_id = s.user_id AND m.wine_type = s.wine_type
GROUP BY s.user_id, s.wine_type, m.mean_stars;

GRANT SELECT ON public.prediction_baseline_comparison TO authenticated;
GRANT SELECT ON public.prediction_baseline_comparison TO service_role;


-- ============================================================
-- View 3 — offered vs chosen (needs scan_wines.predicted_stars)
-- ============================================================
-- Of the wines we put in front of someone, how did the ones they chose
-- compare to the ones they did not?
CREATE VIEW public.scan_offer_outcomes
WITH (security_invoker = on) AS
SELECT
  w.user_id,
  w.scan_id,
  s.scanned_at,
  count(*)                                                        AS n_offered,
  count(w.predicted_stars)                                        AS n_predicted,
  count(w.user_rated_stars)                                       AS n_rated,
  round(avg(w.predicted_stars)::numeric, 3)                       AS mean_predicted_all,
  round(avg(w.predicted_stars) FILTER (WHERE w.user_rated_stars IS NOT NULL)::numeric, 3)
                                                                  AS mean_predicted_chosen,
  round(avg(w.predicted_stars) FILTER (WHERE w.user_rated_stars IS NULL)::numeric, 3)
                                                                  AS mean_predicted_not_chosen,
  round(max(w.predicted_stars)::numeric, 3)                       AS best_predicted_offered,
  round(avg(abs(w.user_rated_stars - w.predicted_stars))::numeric, 3) AS mae_on_chosen
FROM public.scan_wines w
JOIN public.scans s ON s.id = w.scan_id
GROUP BY w.user_id, w.scan_id, s.scanned_at;

GRANT SELECT ON public.scan_offer_outcomes TO authenticated;
GRANT SELECT ON public.scan_offer_outcomes TO service_role;


-- ============================================================
-- save_rating_with_cascade — log unconditionally, before the 2.5 check
-- ============================================================
-- New params are all defaulted, so every existing call site keeps working.
-- NOTHING about scoring, the 2.5 dispute threshold, anchor weighting, or
-- benchmark promotion/demotion changes here.
DROP FUNCTION IF EXISTS public.save_rating_with_cascade(uuid, integer, double precision);

CREATE OR REPLACE FUNCTION public.save_rating_with_cascade(
  p_bottle_id uuid,
  p_stars integer,
  p_predicted double precision DEFAULT NULL::double precision,
  p_omega jsonb DEFAULT NULL,
  p_bandwidth double precision DEFAULT NULL,
  p_n_rated int DEFAULT NULL,
  p_source text DEFAULT 'other',
  p_scan_id uuid DEFAULT NULL,
  p_scan_wine_id uuid DEFAULT NULL,
  p_predicted_rank int DEFAULT NULL,
  p_null_reason text DEFAULT NULL
)
RETURNS TABLE(demoted_tier text, previous_stars integer, palate_version integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
  -- Every scan that happens before this log exists is a measurement
  -- permanently lost, so it records the miss and the hit alike. A clearing
  -- (p_stars IS NULL) is not an outcome, so it is the only skip.
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
      source, scan_id, scan_wine_id, fp_pipeline, predicted_rank, null_reason
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
      CASE WHEN p_predicted IS NULL THEN v_null_reason END
    FROM public.profiles pr WHERE pr.id = uid;
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

  RETURN QUERY SELECT v_demoted, v_prev_stars, v_new_version;
END
$function$;

GRANT EXECUTE ON FUNCTION public.save_rating_with_cascade(
  uuid, integer, double precision, jsonb, double precision, int, text, uuid, uuid, int, text
) TO authenticated;