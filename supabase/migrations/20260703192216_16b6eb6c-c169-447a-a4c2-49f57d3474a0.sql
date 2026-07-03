CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.bottles ADD COLUMN IF NOT EXISTS fp_vec extensions.vector(8);

UPDATE public.bottles
SET fp_vec = ARRAY[
  coalesce(fp_fresh, 0),
  coalesce(fp_acid, 0),
  coalesce(fp_tannin, 0),
  coalesce(fp_fruit_dark, 0),
  coalesce(fp_ripe, 0),
  coalesce(fp_oak, 0),
  coalesce(fp_body, 0),
  coalesce(fp_savory, 0)
]::extensions.vector
WHERE fp_vec IS NULL;

CREATE INDEX IF NOT EXISTS bottles_fp_vec_hnsw
  ON public.bottles
  USING hnsw (fp_vec extensions.vector_l2_ops);

CREATE OR REPLACE FUNCTION public.bottles_sync_fp_vec()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.fp_vec IS NULL
     OR NEW.fp_fresh      IS DISTINCT FROM OLD.fp_fresh
     OR NEW.fp_acid       IS DISTINCT FROM OLD.fp_acid
     OR NEW.fp_tannin     IS DISTINCT FROM OLD.fp_tannin
     OR NEW.fp_fruit_dark IS DISTINCT FROM OLD.fp_fruit_dark
     OR NEW.fp_ripe       IS DISTINCT FROM OLD.fp_ripe
     OR NEW.fp_oak        IS DISTINCT FROM OLD.fp_oak
     OR NEW.fp_body       IS DISTINCT FROM OLD.fp_body
     OR NEW.fp_savory     IS DISTINCT FROM OLD.fp_savory
  THEN
    NEW.fp_vec := ARRAY[
      coalesce(NEW.fp_fresh, 0),
      coalesce(NEW.fp_acid, 0),
      coalesce(NEW.fp_tannin, 0),
      coalesce(NEW.fp_fruit_dark, 0),
      coalesce(NEW.fp_ripe, 0),
      coalesce(NEW.fp_oak, 0),
      coalesce(NEW.fp_body, 0),
      coalesce(NEW.fp_savory, 0)
    ]::extensions.vector;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bottles_sync_fp_vec_trg ON public.bottles;
CREATE TRIGGER bottles_sync_fp_vec_trg
  BEFORE INSERT OR UPDATE ON public.bottles
  FOR EACH ROW EXECUTE FUNCTION public.bottles_sync_fp_vec();

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
BEGIN
  CREATE TEMP TABLE _pour_hits (id uuid PRIMARY KEY) ON COMMIT DROP;

  -- (a) nearest neighbors per loved cuvée fingerprint (cap 20 loved)
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(loved, '[]'::jsonb))
  LOOP
    EXIT WHEN loved_count >= 20;
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

    INSERT INTO _pour_hits (id)
    SELECT b.id
    FROM public.bottles b
    WHERE lower(coalesce(b.type,'')) = loved_type
      AND NOT (b.id = ANY(excluded_ids))
      AND b.fp_vec IS NOT NULL
    ORDER BY b.fp_vec OPERATOR(extensions.<->) loved_vec
    LIMIT per_loved
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- (b) top critic-scored bottles per rated type
  FOREACH t IN ARRAY coalesce(rated_types, ARRAY[]::text[])
  LOOP
    INSERT INTO _pour_hits (id)
    SELECT b.id
    FROM public.bottles b
    WHERE lower(coalesce(b.type,'')) = lower(t)
      AND b.critic_score IS NOT NULL
      AND NOT (b.id = ANY(excluded_ids))
    ORDER BY b.critic_score DESC NULLS LAST
    LIMIT per_type_critic
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN QUERY
  SELECT b.*
  FROM public.bottles b
  JOIN _pour_hits h ON h.id = b.id
  LIMIT overall_cap;
END $$;