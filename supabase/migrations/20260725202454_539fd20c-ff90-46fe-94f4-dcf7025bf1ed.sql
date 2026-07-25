
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
  v_pass BOOLEAN;
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
  SELECT g.global_pass INTO v_pass FROM public.admin_consensus_gate_status() AS g;

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

      v_eligible := v_pass
                    AND rec.sign_frac >= p_sign_consistency
                    AND ABS(rec.mean_e) >= 0.5;
      v_reason := CASE
        WHEN NOT v_pass THEN 'global_gate_fail'
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

  RETURN QUERY SELECT v_run, v_bottles_elig, v_axes_count, v_written, v_pass;
END;
$$;
