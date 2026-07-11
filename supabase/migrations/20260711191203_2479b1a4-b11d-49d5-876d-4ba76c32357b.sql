
CREATE OR REPLACE FUNCTION public.rpc_fingerprint_reach(
  fp_fresh float, fp_acid float, fp_tannin float, fp_fruit_dark float,
  fp_ripe float, fp_oak float, fp_body float, fp_savory float,
  wine_type text, h float DEFAULT 0.20, sample_size int DEFAULT 2000
) RETURNS float
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $$
  WITH pool AS (
    SELECT b.fp_fresh, b.fp_acid, b.fp_tannin, b.fp_fruit_dark,
           b.fp_ripe, b.fp_oak, b.fp_body, b.fp_savory
    FROM public.bottles b
    WHERE b.type = lower(wine_type)
      AND b.fp_fresh IS NOT NULL
      AND b.excluded_from_recs = false
    ORDER BY random()
    LIMIT greatest(sample_size, 100)
  )
  SELECT COALESCE(avg((
    sqrt(
      power(p.fp_fresh      - fp_fresh, 2) +
      power(p.fp_acid       - fp_acid, 2) +
      power(p.fp_tannin     - fp_tannin, 2) +
      power(p.fp_fruit_dark - fp_fruit_dark, 2) +
      power(p.fp_ripe       - fp_ripe, 2) +
      power(p.fp_oak        - fp_oak, 2) +
      power(p.fp_body       - fp_body, 2) +
      power(p.fp_savory     - fp_savory, 2)
    ) < h
  )::int)::float, 0)
  FROM pool p
$$;

GRANT EXECUTE ON FUNCTION public.rpc_fingerprint_reach(
  float, float, float, float, float, float, float, float, text, float, int
) TO anon, authenticated;
