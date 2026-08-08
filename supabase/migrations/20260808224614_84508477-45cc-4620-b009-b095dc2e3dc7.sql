DROP VIEW IF EXISTS public.prediction_axis_bias;

-- Per-axis prediction bias.
--
-- SAMPLE FLOORS. Inferential columns (error_axis_corr, mean_error_when_higher,
-- mean_error_when_lower) return NULL below n = 15 rows per (user, wine type,
-- pipeline, axis). A correlation over three rows returns a confident-looking
-- number that means nothing, and the split-direction means divide an already
-- small n in two.
--
-- 15 IS A GUESS. It is not derived from data, from a power calculation, or from
-- observed variance in this log. It is a placeholder chosen to be obviously
-- larger than the handful of rows present when this floor was added. Revisit it
-- once the log is large enough to estimate the sampling distribution of
-- error_axis_corr directly, and replace this comment with the derived number.
--
-- mean_signed_error and mean_axis_delta are descriptive rather than inferential
-- and show at any n. n, n_higher and n_lower are exposed so the threshold is
-- inspectable rather than hidden.
CREATE VIEW public.prediction_axis_bias AS
SELECT
  o.user_id,
  b.type AS wine_type,
  o.fp_pipeline,
  ax.key AS axis,
  count(*) AS n,
  count(*) FILTER (WHERE ((ax.value #>> '{}') ::double precision) > 0) AS n_higher,
  count(*) FILTER (WHERE ((ax.value #>> '{}') ::double precision) < 0) AS n_lower,
  15 AS min_n_for_inference,
  round(avg(o.delta)::numeric, 3) AS mean_signed_error,
  round(avg(((ax.value #>> '{}')::double precision))::numeric, 3) AS mean_axis_delta,
  CASE WHEN count(*) >= 15
    THEN round(corr(o.delta, ((ax.value #>> '{}')::double precision))::numeric, 3)
  END AS error_axis_corr,
  CASE WHEN count(*) FILTER (WHERE ((ax.value #>> '{}')::double precision) > 0) >= 15
    THEN round(avg(o.delta) FILTER (WHERE ((ax.value #>> '{}')::double precision) > 0)::numeric, 3)
  END AS mean_error_when_higher,
  CASE WHEN count(*) FILTER (WHERE ((ax.value #>> '{}')::double precision) < 0) >= 15
    THEN round(avg(o.delta) FILTER (WHERE ((ax.value #>> '{}')::double precision) < 0)::numeric, 3)
  END AS mean_error_when_lower,
  count(*) FILTER (WHERE o.miss_attribution = 'fingerprint') AS n_style_was_wrong,
  count(*) FILTER (WHERE o.miss_attribution = 'palate') AS n_taste_was_wrong
FROM public.prediction_outcomes o
JOIN public.bottles b ON b.id = o.bottle_id
CROSS JOIN LATERAL jsonb_each(COALESCE(o.axis_deltas -> 'axes', '{}'::jsonb)) ax(key, value)
WHERE o.delta IS NOT NULL
GROUP BY o.user_id, b.type, o.fp_pipeline, ax.key;

GRANT SELECT ON public.prediction_axis_bias TO service_role;