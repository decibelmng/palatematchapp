CREATE OR REPLACE FUNCTION public.rpc_type_centroids()
RETURNS TABLE(
  type text,
  n bigint,
  fresh double precision,
  acid double precision,
  tannin double precision,
  fruit_dark double precision,
  ripe double precision,
  oak double precision,
  body double precision,
  savory double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    b.type,
    count(*)::bigint,
    avg(b.fp_fresh)::double precision,
    avg(b.fp_acid)::double precision,
    avg(b.fp_tannin)::double precision,
    avg(b.fp_fruit_dark)::double precision,
    avg(b.fp_ripe)::double precision,
    avg(b.fp_oak)::double precision,
    avg(b.fp_body)::double precision,
    avg(b.fp_savory)::double precision
  FROM public.bottles b
  WHERE b.excluded_from_recs = false
    AND b.fp_fresh IS NOT NULL
    AND b.type IS NOT NULL
  GROUP BY b.type;
$$;

REVOKE ALL ON FUNCTION public.rpc_type_centroids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_type_centroids() TO authenticated, service_role;