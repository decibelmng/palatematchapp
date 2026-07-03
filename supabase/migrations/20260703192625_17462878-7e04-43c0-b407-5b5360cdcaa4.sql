CREATE OR REPLACE FUNCTION public.rpc_pour_candidates(
  loved jsonb,
  rated_types text[],
  excluded_ids uuid[] DEFAULT ARRAY[]::uuid[],
  per_loved integer DEFAULT 40,
  per_type_critic integer DEFAULT 150,
  overall_cap integer DEFAULT 800
)
RETURNS SETOF public.bottles
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  l jsonb;
  loved_type text;
  loved_vec extensions.vector(8);
  t text;
  loved_count int := 0;
  total int := 0;
  remaining int;
  batch_ids uuid[];
  seen uuid[] := coalesce(excluded_ids, ARRAY[]::uuid[]);
BEGIN
  -- (a) nearest neighbors per loved cuvée (cap 20 loved)
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(loved, '[]'::jsonb))
  LOOP
    EXIT WHEN loved_count >= 20 OR total >= overall_cap;
    loved_count := loved_count + 1;

    loved_type := lower(l->>'type');
    loved_vec := ARRAY[
      (l->>'fresh')::float,
      (l->>'acid')::float,
      (l->>'tannin')::float,
      (l->>'fruit_dark')::float,
      (l->>'ripe')::float,
      (l->>'oak')::float,
      (l->>'body')::float,
      (l->>'savory')::float
    ]::extensions.vector;

    remaining := overall_cap - total;

    SELECT array_agg(x.id) INTO batch_ids FROM (
      SELECT b.id
      FROM public.bottles b
      WHERE lower(coalesce(b.type,'')) = loved_type
        AND b.fp_vec IS NOT NULL
        AND NOT (b.id = ANY(seen))
      ORDER BY b.fp_vec OPERATOR(extensions.<->) loved_vec
      LIMIT least(per_loved, remaining)
    ) x;

    IF batch_ids IS NOT NULL AND array_length(batch_ids, 1) > 0 THEN
      seen := seen || batch_ids;
      total := total + array_length(batch_ids, 1);

      RETURN QUERY
      SELECT b.* FROM public.bottles b WHERE b.id = ANY(batch_ids);
    END IF;
  END LOOP;

  -- (b) per-type critic_score slice
  FOREACH t IN ARRAY coalesce(rated_types, ARRAY[]::text[])
  LOOP
    EXIT WHEN total >= overall_cap;
    remaining := overall_cap - total;

    SELECT array_agg(x.id) INTO batch_ids FROM (
      SELECT b.id
      FROM public.bottles b
      WHERE lower(coalesce(b.type,'')) = lower(t)
        AND b.critic_score IS NOT NULL
        AND NOT (b.id = ANY(seen))
      ORDER BY b.critic_score DESC NULLS LAST
      LIMIT least(per_type_critic, remaining)
    ) x;

    IF batch_ids IS NOT NULL AND array_length(batch_ids, 1) > 0 THEN
      seen := seen || batch_ids;
      total := total + array_length(batch_ids, 1);

      RETURN QUERY
      SELECT b.* FROM public.bottles b WHERE b.id = ANY(batch_ids);
    END IF;
  END LOOP;

  RETURN;
END $$;