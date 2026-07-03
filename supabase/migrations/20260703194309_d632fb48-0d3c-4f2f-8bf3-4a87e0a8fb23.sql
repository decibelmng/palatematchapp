DROP FUNCTION IF EXISTS public.rpc_pour_candidates(jsonb, text[], uuid[], integer, integer, integer);

CREATE OR REPLACE FUNCTION public.rpc_pour_candidates(
  loved jsonb,
  rated_types text[],
  excluded_ids uuid[] DEFAULT ARRAY[]::uuid[],
  per_loved integer DEFAULT 40,
  per_type_critic integer DEFAULT 150,
  overall_cap integer DEFAULT 800
)
RETURNS TABLE (
  id uuid,
  name text,
  producer text,
  region text,
  grape text,
  vintage integer,
  type text,
  critic_score integer,
  price_band text,
  fp_fresh real,
  fp_acid real,
  fp_tannin real,
  fp_fruit_dark real,
  fp_ripe real,
  fp_oak real,
  fp_body real,
  fp_savory real,
  ax_body real,
  ax_fruit_char real,
  ax_tannin real,
  ax_acidity real,
  ax_sweet real,
  tasting_note text,
  source text,
  added_by uuid
)
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
      SELECT
        b.id, b.name, b.producer, b.region, b.grape, b.vintage, b.type,
        b.critic_score, b.price_band,
        b.fp_fresh, b.fp_acid, b.fp_tannin, b.fp_fruit_dark,
        b.fp_ripe, b.fp_oak, b.fp_body, b.fp_savory,
        b.ax_body, b.ax_fruit_char, b.ax_tannin, b.ax_acidity, b.ax_sweet,
        b.tasting_note, b.source, b.added_by
      FROM public.bottles b WHERE b.id = ANY(batch_ids);
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
      SELECT
        b.id, b.name, b.producer, b.region, b.grape, b.vintage, b.type,
        b.critic_score, b.price_band,
        b.fp_fresh, b.fp_acid, b.fp_tannin, b.fp_fruit_dark,
        b.fp_ripe, b.fp_oak, b.fp_body, b.fp_savory,
        b.ax_body, b.ax_fruit_char, b.ax_tannin, b.ax_acidity, b.ax_sweet,
        b.tasting_note, b.source, b.added_by
      FROM public.bottles b WHERE b.id = ANY(batch_ids);
    END IF;
  END LOOP;

  RETURN;
END $$;