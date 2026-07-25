
CREATE TABLE IF NOT EXISTS public.fp_consensus_candidates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL,
  bottle_id UUID NOT NULL REFERENCES public.bottles(id) ON DELETE CASCADE,
  axis TEXT NOT NULL,
  n_raters INTEGER NOT NULL,
  n_palate_codes INTEGER NOT NULL,
  mean_residual REAL NOT NULL,
  sign_consistency REAL NOT NULL,
  prior_value REAL NOT NULL,
  proposed_value REAL NOT NULL,
  eligible BOOLEAN NOT NULL,
  reason TEXT,
  written_observation_id UUID REFERENCES public.fp_observations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fp_consensus_candidates TO authenticated;
GRANT ALL ON public.fp_consensus_candidates TO service_role;

ALTER TABLE public.fp_consensus_candidates ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_fp_consensus_run ON public.fp_consensus_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_fp_consensus_bottle ON public.fp_consensus_candidates(bottle_id);


CREATE OR REPLACE FUNCTION public.admin_consensus_gate_status()
RETURNS TABLE(
  total_ratings BIGINT,
  distinct_users BIGINT,
  min_ratings INTEGER,
  min_users INTEGER,
  global_pass BOOLEAN
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT COUNT(*)::bigint FROM ratings),
    (SELECT COUNT(DISTINCT user_id)::bigint FROM ratings),
    500,
    25,
    (SELECT COUNT(*) FROM ratings) >= 500
      AND (SELECT COUNT(DISTINCT user_id) FROM ratings) >= 25;
$$;


CREATE OR REPLACE FUNCTION public.admin_consensus_scan(
  p_write BOOLEAN DEFAULT false,
  p_surprise REAL DEFAULT 1.0,
  p_min_raters INTEGER DEFAULT 8,
  p_min_palates INTEGER DEFAULT 4,
  p_sign_consistency REAL DEFAULT 0.75,
  p_step REAL DEFAULT 0.05
)
RETURNS TABLE(
  run_id UUID,
  bottles_eligible INTEGER,
  axes_evaluated INTEGER,
  observations_written INTEGER,
  global_pass BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run UUID := gen_random_uuid();
  v_global_pass BOOLEAN;
  v_bottles_elig INTEGER := 0;
  v_axes_count INTEGER := 0;
  v_written INTEGER := 0;
  v_axes_arr TEXT[] := ARRAY['fresh','acid','tannin','fruit_dark','ripe','oak','body','savory'];
  a TEXT;
  rec RECORD;
  v_obs_id UUID;
  v_prior REAL;
  v_proposed REAL;
  v_eligible BOOLEAN;
  v_reason TEXT;
BEGIN
  SELECT global_pass INTO v_global_pass FROM public.admin_consensus_gate_status();

  CREATE TEMP TABLE _surprises ON COMMIT DROP AS
  WITH user_type_mean AS (
    SELECT r.user_id, b.type, AVG(r.stars)::real AS mu
    FROM ratings r JOIN bottles b ON b.id = r.bottle_id
    GROUP BY r.user_id, b.type
  ),
  scored AS (
    SELECT
      r.id AS rating_id, r.user_id, r.bottle_id, r.stars, b.type,
      utm.mu AS predicted,
      (r.stars - utm.mu)::real AS residual
    FROM ratings r
    JOIN bottles b ON b.id = r.bottle_id
    JOIN user_type_mean utm ON utm.user_id = r.user_id AND utm.type = b.type
  )
  SELECT s.*, p.palate_code
    FROM scored s
    JOIN profiles p ON p.id = s.user_id
   WHERE ABS(s.residual) >= p_surprise
     AND NOT (s.predicted >= 4 AND s.stars >= 4)
     AND NOT (s.predicted <= 2 AND s.stars <= 2);

  CREATE TEMP TABLE _eligible_bottles ON COMMIT DROP AS
  SELECT bottle_id,
         COUNT(DISTINCT user_id)::int     AS n_raters,
         COUNT(DISTINCT palate_code)::int AS n_palates
    FROM _surprises
   GROUP BY bottle_id
  HAVING COUNT(DISTINCT user_id)     >= p_min_raters
     AND COUNT(DISTINCT palate_code) >= p_min_palates;

  SELECT COUNT(*)::int INTO v_bottles_elig FROM _eligible_bottles;

  FOR rec IN
    WITH means AS (
      SELECT s.bottle_id, AVG(s.residual)::real AS mean_e, COUNT(*)::int AS n
        FROM _surprises s JOIN _eligible_bottles eb USING (bottle_id)
       GROUP BY s.bottle_id
    ),
    consist AS (
      SELECT s.bottle_id,
             SUM(CASE WHEN sign(s.residual) = sign(m.mean_e) THEN 1 ELSE 0 END)::real
             / NULLIF(m.n,0)::real AS sign_frac
        FROM _surprises s JOIN means m USING (bottle_id)
       GROUP BY s.bottle_id, m.n
    )
    SELECT m.bottle_id, m.mean_e, c.sign_frac, eb.n_raters, eb.n_palates
      FROM means m
      JOIN consist c USING (bottle_id)
      JOIN _eligible_bottles eb USING (bottle_id)
  LOOP
    FOREACH a IN ARRAY v_axes_arr LOOP
      EXECUTE format('SELECT fp_%I_prior FROM bottles WHERE id = $1', a)
        USING rec.bottle_id INTO v_prior;

      v_proposed := GREATEST(0.0, LEAST(1.0,
        v_prior + p_step * sign(rec.mean_e)::real
      ));

      v_eligible := v_global_pass
                    AND rec.sign_frac >= p_sign_consistency
                    AND ABS(rec.mean_e) >= 0.5;
      v_reason := CASE
        WHEN NOT v_global_pass THEN 'global_gate_fail'
        WHEN rec.sign_frac < p_sign_consistency THEN 'sign_inconsistent'
        WHEN ABS(rec.mean_e) < 0.5 THEN 'residual_too_small'
        ELSE 'eligible'
      END;

      v_obs_id := NULL;
      IF v_eligible AND p_write THEN
        INSERT INTO fp_observations(
          bottle_id, axis, observed_value, precision,
          source_type, mode, author_id, rationale
        ) VALUES (
          rec.bottle_id, a, v_proposed, 1,
          'consensus_miss', 'shadow', NULL,
          format('consensus run=%s n=%s palates=%s sign=%.2f mean_e=%.3f',
                 v_run, rec.n_raters, rec.n_palates, rec.sign_frac, rec.mean_e)
        )
        RETURNING id INTO v_obs_id;
        v_written := v_written + 1;
      END IF;

      INSERT INTO fp_consensus_candidates(
        run_id, bottle_id, axis, n_raters, n_palate_codes,
        mean_residual, sign_consistency, prior_value, proposed_value,
        eligible, reason, written_observation_id
      ) VALUES (
        v_run, rec.bottle_id, a, rec.n_raters, rec.n_palates,
        rec.mean_e, rec.sign_frac, v_prior, v_proposed,
        v_eligible, v_reason, v_obs_id
      );
      v_axes_count := v_axes_count + 1;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_run, v_bottles_elig, v_axes_count, v_written, v_global_pass;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_consensus_validate(
  p_observation_id UUID
)
RETURNS TABLE(
  observation_id UUID,
  bottle_id UUID,
  axis TEXT,
  n_test INTEGER,
  err_prior REAL,
  err_shadow REAL,
  promoted BOOLEAN,
  reason TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY created_at)
    INTO v_split FROM ratings WHERE bottle_id = v_bottle;

  IF v_split IS NULL THEN
    RETURN QUERY SELECT p_observation_id, v_bottle, v_axis, 0, 0::real, 0::real, false,
      'no_ratings_for_bottle'::text;
    RETURN;
  END IF;

  WITH tst AS (
    SELECT stars FROM ratings WHERE bottle_id = v_bottle AND created_at > v_split
  ),
  train AS (
    SELECT COUNT(*)::int AS n FROM ratings WHERE bottle_id = v_bottle AND created_at <= v_split
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
    UPDATE fp_observations SET mode = 'live' WHERE id = p_observation_id;
    v_promoted := true;
    v_reason := 'promoted';
    PERFORM public.admin_fp_recompute_bottle(v_bottle);
  ELSE
    v_reason := 'shadow_no_better_than_prior';
  END IF;

  RETURN QUERY SELECT p_observation_id, v_bottle, v_axis, v_n_test, v_e_prior, v_e_shadow, v_promoted, v_reason;
END;
$$;


CREATE OR REPLACE FUNCTION public.admin_fp_drift()
RETURNS TABLE(
  n_bottles BIGINT,
  drift_sum REAL,
  drift_max REAL,
  drift_p95 REAL,
  n_moved BIGINT
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (
    SELECT id,
           SQRT(
             (fp_fresh      - fp_fresh_prior)^2      +
             (fp_acid       - fp_acid_prior)^2       +
             (fp_tannin     - fp_tannin_prior)^2     +
             (fp_fruit_dark - fp_fruit_dark_prior)^2 +
             (fp_ripe       - fp_ripe_prior)^2       +
             (fp_oak        - fp_oak_prior)^2        +
             (fp_body       - fp_body_prior)^2       +
             (fp_savory     - fp_savory_prior)^2
           )::real AS dist
    FROM bottles
  )
  SELECT COUNT(*)::bigint,
         COALESCE(SUM(dist),0)::real,
         COALESCE(MAX(dist),0)::real,
         COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY dist), 0)::real,
         COUNT(*) FILTER (WHERE dist > 1e-4)::bigint
    FROM d;
$$;

REVOKE ALL ON FUNCTION public.admin_consensus_gate_status()       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_consensus_scan(boolean,real,integer,integer,real,real) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_consensus_validate(uuid)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_fp_drift()                    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_consensus_gate_status()    TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_consensus_scan(boolean,real,integer,integer,real,real) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_consensus_validate(uuid)   TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_fp_drift()                 TO service_role;
