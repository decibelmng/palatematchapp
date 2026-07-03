
CREATE OR REPLACE FUNCTION public.rpc_pour_candidates(
  loved jsonb,
  rated_types text[],
  excluded_ids uuid[] DEFAULT ARRAY[]::uuid[],
  per_loved int DEFAULT 40,
  per_type_critic int DEFAULT 150,
  overall_cap int DEFAULT 800
)
RETURNS SETOF public.bottles
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH nn AS (
    SELECT b.*
    FROM jsonb_array_elements(coalesce(loved, '[]'::jsonb)) l,
    LATERAL (
      SELECT b2.*
      FROM public.bottles b2
      WHERE lower(coalesce(b2.type,'')) = lower(l->>'type')
        AND NOT (b2.id = ANY(excluded_ids))
      ORDER BY (
        power(b2.fp_fresh      - (l->>'fresh')::float,      2) +
        power(b2.fp_acid       - (l->>'acid')::float,       2) +
        power(b2.fp_tannin     - (l->>'tannin')::float,     2) +
        power(b2.fp_fruit_dark - (l->>'fruit_dark')::float, 2) +
        power(b2.fp_ripe       - (l->>'ripe')::float,       2) +
        power(b2.fp_oak        - (l->>'oak')::float,        2) +
        power(b2.fp_body       - (l->>'body')::float,       2) +
        power(b2.fp_savory     - (l->>'savory')::float,     2)
      ) ASC
      LIMIT per_loved
    ) b
  ),
  critic AS (
    SELECT b.*
    FROM unnest(coalesce(rated_types, ARRAY[]::text[])) t
    JOIN LATERAL (
      SELECT b2.*
      FROM public.bottles b2
      WHERE lower(coalesce(b2.type,'')) = lower(t)
        AND b2.critic_score IS NOT NULL
        AND NOT (b2.id = ANY(excluded_ids))
      ORDER BY b2.critic_score DESC NULLS LAST
      LIMIT per_type_critic
    ) b ON TRUE
  ),
  all_rows AS (
    SELECT * FROM nn
    UNION
    SELECT * FROM critic
  )
  SELECT DISTINCT ON (id) *
  FROM all_rows
  LIMIT overall_cap;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_pour_candidates(jsonb, text[], uuid[], int, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_pour_candidates(jsonb, text[], uuid[], int, int, int) TO service_role;
