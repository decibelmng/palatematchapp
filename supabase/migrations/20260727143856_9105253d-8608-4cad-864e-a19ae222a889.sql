
CREATE OR REPLACE FUNCTION public.admin_fp_recompute_bottle(p_bottle_id uuid)
RETURNS TABLE(axis text, old_value real, new_value real, sum_lambda real, moved boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b_tau0        real;
  b_priors      real[];
  b_live        real[];
  axes          text[] := ARRAY['fresh','acid','tannin','fruit_dark','ripe','oak','body','savory'];
  i             int;
  a             text;
  prior_val     real;
  sum_l         double precision;
  sum_lo        double precision;
  mu_star       double precision;
  new_val       real;
  moved_val     boolean;
  E_MIN         constant real := 5.0;
  DELTA_MAX     constant real := 0.10;
  PER_AUTHOR    constant real := 0.25;
  cap_ok        boolean;
  v_moved_axes  int := 0;
  v_obs_total   int := 0;
  results       record;
BEGIN
  SELECT fp_prior_precision,
         ARRAY[fp_fresh_prior, fp_acid_prior, fp_tannin_prior, fp_fruit_dark_prior,
               fp_ripe_prior, fp_oak_prior, fp_body_prior, fp_savory_prior],
         ARRAY[fp_fresh, fp_acid, fp_tannin, fp_fruit_dark,
               fp_ripe, fp_oak, fp_body, fp_savory]
    INTO b_tau0, b_priors, b_live
    FROM public.bottles WHERE id = p_bottle_id;

  IF b_tau0 IS NULL THEN
    RAISE EXCEPTION 'admin_fp_recompute_bottle: bottle % not found', p_bottle_id;
  END IF;

  CREATE TEMP TABLE _fp_recompute_out(
    axis text, old_value real, new_value real, sum_lambda real, moved boolean
  ) ON COMMIT DROP;

  FOR i IN 1..8 LOOP
    a := axes[i];
    prior_val := b_priors[i];

    SELECT COALESCE(SUM(o.precision), 0),
           COALESCE(SUM(o.precision * o.observed_value), 0)
      INTO sum_l, sum_lo
      FROM public.fp_observations o
      WHERE o.bottle_id = p_bottle_id AND o.axis = a
        AND o.mode = 'live' AND o.superseded = false;

    IF sum_l < E_MIN THEN
      new_val := prior_val;
    ELSE
      SELECT COALESCE(
        MAX(author_share) FILTER (WHERE source_type <> 'expert_admin')
      ) IS NULL OR COALESCE(
        MAX(author_share) FILTER (WHERE source_type <> 'expert_admin'), 0
      ) <= PER_AUTHOR
        INTO cap_ok
        FROM (
          SELECT o.author_id, o.source_type,
                 SUM(o.precision) / NULLIF(sum_l, 0) AS author_share
          FROM public.fp_observations o
          WHERE o.bottle_id = p_bottle_id AND o.axis = a
            AND o.mode = 'live' AND o.superseded = false
          GROUP BY o.author_id, o.source_type
        ) s;

      IF NOT cap_ok THEN
        new_val := prior_val;
      ELSE
        mu_star := (b_tau0::double precision * prior_val + sum_lo) / (b_tau0 + sum_l);
        IF (mu_star - b_live[i]) > DELTA_MAX THEN
          new_val := b_live[i] + DELTA_MAX;
        ELSIF (b_live[i] - mu_star) > DELTA_MAX THEN
          new_val := b_live[i] - DELTA_MAX;
        ELSE
          new_val := mu_star::real;
        END IF;
      END IF;
    END IF;

    moved_val := ABS(new_val - prior_val) > 1e-6;
    IF moved_val THEN v_moved_axes := v_moved_axes + 1; END IF;

    INSERT INTO _fp_recompute_out(axis, old_value, new_value, sum_lambda, moved)
      VALUES (a, b_live[i], new_val, sum_l::real, moved_val);

    IF a = 'fresh'      THEN UPDATE public.bottles SET fp_fresh      = new_val WHERE id = p_bottle_id;
    ELSIF a = 'acid'    THEN UPDATE public.bottles SET fp_acid       = new_val WHERE id = p_bottle_id;
    ELSIF a = 'tannin'  THEN UPDATE public.bottles SET fp_tannin     = new_val WHERE id = p_bottle_id;
    ELSIF a = 'fruit_dark' THEN UPDATE public.bottles SET fp_fruit_dark = new_val WHERE id = p_bottle_id;
    ELSIF a = 'ripe'    THEN UPDATE public.bottles SET fp_ripe       = new_val WHERE id = p_bottle_id;
    ELSIF a = 'oak'     THEN UPDATE public.bottles SET fp_oak        = new_val WHERE id = p_bottle_id;
    ELSIF a = 'body'    THEN UPDATE public.bottles SET fp_body       = new_val WHERE id = p_bottle_id;
    ELSIF a = 'savory'  THEN UPDATE public.bottles SET fp_savory     = new_val WHERE id = p_bottle_id;
    END IF;
  END LOOP;

  SELECT COUNT(*)::int INTO v_obs_total
    FROM public.fp_observations
    WHERE bottle_id = p_bottle_id AND mode = 'live' AND superseded = false;

  UPDATE public.bottles
    SET refingerprinted_at = now(),
        fp_obs_blend_count = v_obs_total,
        fp_blended = (v_moved_axes > 0)
    WHERE id = p_bottle_id;

  RETURN QUERY SELECT * FROM _fp_recompute_out;
END;
$$;
