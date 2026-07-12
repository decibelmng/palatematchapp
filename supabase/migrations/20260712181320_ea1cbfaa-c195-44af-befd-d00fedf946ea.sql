DROP FUNCTION IF EXISTS public.rpc_fingerprint_reach(
  double precision, double precision, double precision, double precision,
  double precision, double precision, double precision, double precision,
  text, double precision, integer
);

CREATE FUNCTION public.rpc_fingerprint_reach(
  p_fp_fresh      double precision,
  p_fp_acid       double precision,
  p_fp_tannin     double precision,
  p_fp_fruit_dark double precision,
  p_fp_ripe       double precision,
  p_fp_oak        double precision,
  p_fp_body       double precision,
  p_fp_savory     double precision,
  p_wine_type     text,
  p_h             double precision DEFAULT 0.30,
  p_sample_size   integer          DEFAULT 2000
)
RETURNS double precision
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH pool AS (
    SELECT b.fp_fresh, b.fp_acid, b.fp_tannin, b.fp_fruit_dark,
           b.fp_ripe, b.fp_oak, b.fp_body, b.fp_savory
    FROM public.bottles b
    WHERE b.type = lower(p_wine_type)
      AND b.fp_fresh IS NOT NULL
      AND b.excluded_from_recs = false
    ORDER BY random()
    LIMIT greatest(p_sample_size, 100)
  )
  SELECT COALESCE(avg((
    sqrt(
      power(p.fp_fresh      - p_fp_fresh,      2) +
      power(p.fp_acid       - p_fp_acid,       2) +
      power(p.fp_tannin     - p_fp_tannin,     2) +
      power(p.fp_fruit_dark - p_fp_fruit_dark, 2) +
      power(p.fp_ripe       - p_fp_ripe,       2) +
      power(p.fp_oak        - p_fp_oak,        2) +
      power(p.fp_body       - p_fp_body,       2) +
      power(p.fp_savory     - p_fp_savory,     2)
    ) < p_h
  )::int)::float, 0)
  FROM pool p
$function$;