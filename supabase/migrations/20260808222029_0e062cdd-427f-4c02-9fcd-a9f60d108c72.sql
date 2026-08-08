-- 1) neighbour support on the accuracy log. Additive, nullable: existing rows
--    stay valid and simply carry no support figure.
ALTER TABLE public.prediction_outcomes
  ADD COLUMN IF NOT EXISTS neighbor_support integer;

COMMENT ON COLUMN public.prediction_outcomes.neighbor_support IS
  'Count of the user''s own rated (cuvee-aggregated, same-colour) wines within one bandwidth of this candidate in omega-weighted style space, at prediction time. Low = extrapolation, high = interpolation. Measurement only; never read by scoring.';

-- 2) The choice log. This is the signal the product lives or dies on: how
--    often does the person order the wine we led with.
CREATE TABLE IF NOT EXISTS public.scan_outcomes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_id            uuid NOT NULL REFERENCES public.scans(id) ON DELETE CASCADE,
  chosen_bottle_id   uuid NOT NULL REFERENCES public.bottles(id),
  chosen_predicted   double precision,
  chosen_rank        integer,
  call_bottle_id     uuid REFERENCES public.bottles(id),
  call_predicted     double precision,
  n_candidates       integer,
  chosen_price       numeric,
  call_price         numeric,
  list_price_median  numeric,
  chosen_fp_pipeline text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- One answer per person per list; changing the answer replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS scan_outcomes_user_scan_key
  ON public.scan_outcomes (user_id, scan_id);

CREATE INDEX IF NOT EXISTS scan_outcomes_chosen_bottle_idx
  ON public.scan_outcomes (chosen_bottle_id);

COMMENT ON TABLE public.scan_outcomes IS
  'What the person actually ordered off a scanned list, against the ranking we showed them. A pairwise preference over known alternatives at known prices. CAPTURE ONLY — no scoring path reads this table.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_outcomes TO authenticated;
GRANT ALL ON public.scan_outcomes TO service_role;

ALTER TABLE public.scan_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own scan outcomes readable"
  ON public.scan_outcomes FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "own scan outcomes insertable"
  ON public.scan_outcomes FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own scan outcomes updatable"
  ON public.scan_outcomes FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- The control is undoable, so the owner may remove their own answer.
CREATE POLICY "own scan outcomes deletable"
  ON public.scan_outcomes FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER scan_outcomes_touch
  BEFORE UPDATE ON public.scan_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Carry neighbour support through the rating RPC. Appended parameter with a
--    default, so every existing call site keeps working unchanged.
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
  p_neighbor_support integer DEFAULT NULL::integer
)
 RETURNS TABLE(demoted_tier text, previous_stars integer, palate_version integer)
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
      neighbor_support
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
      p_neighbor_support
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

-- 4) The one product number, per person and per list: did they order the Call.
CREATE OR REPLACE VIEW public.scan_call_hit_rate
WITH (security_invoker = true) AS
SELECT
  o.user_id,
  date_trunc('month', o.created_at)                   AS month,
  count(*)                                            AS n_orders_logged,
  count(*) FILTER (WHERE o.chosen_rank = 1)           AS n_took_the_call,
  round(avg((o.chosen_rank = 1)::int)::numeric, 3)     AS call_hit_rate,
  round(avg((o.chosen_rank <= 3)::int)::numeric, 3)    AS top3_hit_rate,
  round(avg(o.chosen_rank)::numeric, 2)               AS mean_chosen_rank,
  round(avg(o.chosen_price - o.call_price)::numeric, 2) AS mean_price_vs_call,
  round(avg(o.n_candidates)::numeric, 1)              AS mean_list_size
FROM public.scan_outcomes o
GROUP BY o.user_id, date_trunc('month', o.created_at);

GRANT SELECT ON public.scan_call_hit_rate TO authenticated;