CREATE OR REPLACE FUNCTION public.admin_consensus_validate(p_observation_id uuid)
 RETURNS TABLE(observation_id uuid, bottle_id uuid, axis text, n_test integer, err_prior real, err_shadow real, promoted boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bottle UUID;
  v_axis TEXT;
  v_obs_val REAL;
  v_prior REAL;
  v_split TIMESTAMPTZ;
  v_n_train INTEGER;
  v_n_test INTEGER;
  v_e_prior REAL;
  v_e_shadow REAL;
  v_promoted BOOLEAN := false;
  v_reason TEXT;
BEGIN
  SELECT o.bottle_id, o.axis, o.observed_value
    INTO v_bottle, v_axis, v_obs_val
  FROM fp_observations o
  WHERE o.id = p_observation_id AND o.mode = 'shadow' AND o.source_type = 'consensus_miss';

  IF v_bottle IS NULL THEN
    RETURN QUERY SELECT p_observation_id, NULL::uuid, NULL::text, 0, 0::real, 0::real, false,
      'not_a_shadow_consensus_observation'::text;
    RETURN;
  END IF;

  EXECUTE format('SELECT fp_%I_prior FROM bottles WHERE id = $1', v_axis)
    USING v_bottle INTO v_prior;

  -- Every column reference is table-qualified: the OUT names bottle_id and axis
  -- are plpgsql variables here, so a bare bottle_id raises 42702.
  SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY r.created_at)
    INTO v_split FROM ratings r WHERE r.bottle_id = v_bottle;

  IF v_split IS NULL THEN
    RETURN QUERY SELECT p_observation_id, v_bottle, v_axis, 0, 0::real, 0::real, false,
      'no_ratings_for_bottle'::text;
    RETURN;
  END IF;

  WITH tst AS (
    SELECT r.stars FROM ratings r WHERE r.bottle_id = v_bottle AND r.created_at > v_split
  ),
  train AS (
    SELECT COUNT(*)::int AS n FROM ratings r WHERE r.bottle_id = v_bottle AND r.created_at <= v_split
  )
  SELECT (SELECT COUNT(*)::int FROM tst),
         (SELECT n FROM train),
         COALESCE( SQRT(AVG( (t.stars - (3 + (v_prior   - 0.5)))^2 ))::real, 0 ),
         COALESCE( SQRT(AVG( (t.stars - (3 + (v_obs_val - 0.5)))^2 ))::real, 0 )
    INTO v_n_test, v_n_train, v_e_prior, v_e_shadow
    FROM tst t;

  IF v_n_test < 4 OR v_n_train < 4 THEN
    v_reason := 'insufficient_test_train_split';
  ELSIF v_e_shadow < v_e_prior THEN
    UPDATE fp_observations o SET mode = 'live' WHERE o.id = p_observation_id;
    v_promoted := true;
    v_reason := 'promoted';
    PERFORM public.admin_fp_recompute_bottle(v_bottle);
  ELSE
    v_reason := 'shadow_no_better_than_prior';
  END IF;

  RETURN QUERY SELECT p_observation_id, v_bottle, v_axis, v_n_test, v_e_prior, v_e_shadow, v_promoted, v_reason;
END;
$function$;