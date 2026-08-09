CREATE OR REPLACE FUNCTION public.search_bottles_fuzzy(
  q text,
  type_variants text[] DEFAULT NULL::text[],
  lim integer DEFAULT 50,
  threshold real DEFAULT 0.3,
  v_vintage integer DEFAULT NULL::integer
)
RETURNS SETOF public.bottles
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  WITH m AS (
    SELECT b.id,
           b.vintage,
           GREATEST(
             word_similarity(q, coalesce(b.name, '')),
             word_similarity(q, coalesce(b.producer, '')),
             word_similarity(q, coalesce(b.region, '')),
             word_similarity(q, coalesce(b.grape, ''))
           ) AS sim
    FROM public.bottles b
    WHERE (type_variants IS NULL OR b.type = ANY(type_variants))
      AND b.excluded_from_recs = false
      AND (
        word_similarity(q, coalesce(b.name, '')) >= threshold
        OR word_similarity(q, coalesce(b.producer, '')) >= threshold
        OR word_similarity(q, coalesce(b.region, '')) >= threshold
        OR word_similarity(q, coalesce(b.grape, '')) >= threshold
      )
  ),
  top_general AS (
    SELECT id, sim, false AS vmatch FROM m ORDER BY sim DESC LIMIT lim
  ),
  top_vintage AS (
    SELECT id, sim, true AS vmatch
    FROM m
    WHERE v_vintage IS NOT NULL AND m.vintage = v_vintage
    ORDER BY sim DESC
    LIMIT lim
  ),
  picked AS (
    SELECT id, max(sim) AS sim, bool_or(vmatch) AS vmatch
    FROM (SELECT * FROM top_vintage UNION ALL SELECT * FROM top_general) u
    GROUP BY id
  )
  SELECT b.*
  FROM public.bottles b
  JOIN picked p ON p.id = b.id
  ORDER BY p.vmatch DESC, p.sim DESC
  LIMIT lim;
$function$;