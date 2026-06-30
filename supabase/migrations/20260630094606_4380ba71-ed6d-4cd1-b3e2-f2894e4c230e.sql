
CREATE OR REPLACE FUNCTION public.search_bottles_fuzzy(
  q text,
  type_variants text[] DEFAULT NULL,
  lim int DEFAULT 50,
  threshold real DEFAULT 0.3
)
RETURNS SETOF public.bottles
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT b.*
  FROM public.bottles b
  WHERE (type_variants IS NULL OR b.type = ANY(type_variants))
    AND (
      word_similarity(q, coalesce(b.name, '')) >= threshold
      OR word_similarity(q, coalesce(b.producer, '')) >= threshold
      OR word_similarity(q, coalesce(b.region, '')) >= threshold
      OR word_similarity(q, coalesce(b.grape, '')) >= threshold
    )
  ORDER BY GREATEST(
    word_similarity(q, coalesce(b.name, '')),
    word_similarity(q, coalesce(b.producer, '')),
    word_similarity(q, coalesce(b.region, '')),
    word_similarity(q, coalesce(b.grape, ''))
  ) DESC
  LIMIT lim;
$$;
