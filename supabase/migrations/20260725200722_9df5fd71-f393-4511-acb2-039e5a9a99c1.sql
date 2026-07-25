
-- Deterministic recompute: fp_* = f(fp_*_prior, non-superseded live observations).
-- Idempotent: running twice with no observation change and no capping is a no-op after
-- the move cap has fully converged. Anchored: no observations ⇒ fp_* = fp_*_prior exactly.
CREATE OR REPLACE FUNCTION public.admin_fp_recompute_bottle(p_bottle_id uuid)
RETURNS TABLE (
  axis        text,
  old_value   real,
  new_value   real,
  sum_lambda  real,
  moved       boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b_tau0        real;
  b_priors      real[];  -- 8 in RAX order
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

  FOR i IN 1..8 LOOP
    a := axes[i];
    prior_val := b_priors[i];

    SELECT COALESCE(SUM(o.precision), 0),
           COALESCE(SUM(o.precision * o.observed_value), 0)
      INTO sum_l, sum_lo
      FROM public.fp_observations o
      WHERE o.bottle_id = p_bottle_id
        AND o.axis = a
        AND o.mode = 'live'
        AND o.superseded = false;

    -- Evidence floor: below 5, snap to prior (undoes any prior move).
    IF sum_l < E_MIN THEN
      new_val := prior_val;
    ELSE
      -- Per-author cap: reject if any non-expert author exceeds 25% of Σλ.
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
        -- One dominant non-expert author: refuse to move, snap to prior for this axis.
        new_val := prior_val;
      ELSE
        mu_star := (b_tau0::double precision * prior_val + sum_lo) / (b_tau0 + sum_l);
        -- Move cap: convex step toward μ*.
        IF (mu_star - b_live[i]) > DELTA_MAX THEN
          new_val := b_live[i] + DELTA_MAX;
        ELSIF (b_live[i] - mu_star) > DELTA_MAX THEN
          new_val := b_live[i] - DELTA_MAX;
        ELSE
          new_val := mu_star::real;
        END IF;
        -- Clamp [0,1]
        IF new_val < 0 THEN new_val := 0; END IF;
        IF new_val > 1 THEN new_val := 1; END IF;
      END IF;
    END IF;

    moved_val := (new_val IS DISTINCT FROM b_live[i]);
    -- Write via a case on axis name.
    IF a = 'fresh'      THEN UPDATE public.bottles SET fp_fresh      = new_val WHERE id = p_bottle_id;
    ELSIF a = 'acid'    THEN UPDATE public.bottles SET fp_acid       = new_val, ax_acidity    = new_val WHERE id = p_bottle_id;
    ELSIF a = 'tannin'  THEN UPDATE public.bottles SET fp_tannin     = new_val, ax_tannin     = new_val WHERE id = p_bottle_id;
    ELSIF a = 'fruit_dark' THEN UPDATE public.bottles SET fp_fruit_dark = new_val WHERE id = p_bottle_id;
    ELSIF a = 'ripe'    THEN UPDATE public.bottles SET fp_ripe       = new_val WHERE id = p_bottle_id;
    ELSIF a = 'oak'     THEN UPDATE public.bottles SET fp_oak        = new_val WHERE id = p_bottle_id;
    ELSIF a = 'body'    THEN UPDATE public.bottles SET fp_body       = new_val, ax_body       = new_val WHERE id = p_bottle_id;
    ELSIF a = 'savory'  THEN UPDATE public.bottles SET fp_savory     = new_val, ax_fruit_char = new_val WHERE id = p_bottle_id;
    END IF;

    RETURN QUERY SELECT a, b_live[i], new_val, sum_l::real, moved_val;
  END LOOP;

  -- Stamp only if anything moved (harmless either way).
  UPDATE public.bottles SET refingerprinted_at = now() WHERE id = p_bottle_id;
  -- fp_vec is maintained by trigger bottles_sync_fp_vec on the fp_* UPDATEs above.
END $$;

REVOKE ALL ON FUNCTION public.admin_fp_recompute_bottle(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_fp_recompute_bottle(uuid) TO service_role;

-- Batch version: apply to every bottle with active live evidence.
CREATE OR REPLACE FUNCTION public.admin_fp_recompute_all()
RETURNS TABLE (bottles_touched bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n bigint := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT bottle_id FROM public.fp_observations
    WHERE mode='live' AND superseded=false
    UNION
    -- Also touch bottles whose live drifted from prior with no active obs (undo path).
    SELECT id FROM public.bottles
    WHERE fp_fresh<>fp_fresh_prior OR fp_acid<>fp_acid_prior OR fp_tannin<>fp_tannin_prior
       OR fp_fruit_dark<>fp_fruit_dark_prior OR fp_ripe<>fp_ripe_prior OR fp_oak<>fp_oak_prior
       OR fp_body<>fp_body_prior OR fp_savory<>fp_savory_prior
  LOOP
    PERFORM public.admin_fp_recompute_bottle(r.bottle_id);
    n := n + 1;
  END LOOP;
  RETURN QUERY SELECT n;
END $$;

REVOKE ALL ON FUNCTION public.admin_fp_recompute_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_fp_recompute_all() TO service_role;
