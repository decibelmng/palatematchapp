-- ─────────────────────────────────────────────────────────────────────────
-- Catalog hygiene: exclude barrel samples / en primeur / cask/tank samples
-- from recommendations, scan matching, and benchmark eligibility.
-- Rows are FLAGGED, not deleted — ratings and cellar-memory history survive.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Column
ALTER TABLE public.bottles
  ADD COLUMN excluded_from_recs boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.bottles.excluded_from_recs IS
  'When true, this bottle is hidden from recommendation pools, scan matching, and cannot be crowned Canon/Nemesis. Barrel samples, en primeur, cask/tank samples. Ratings remain readable so history survives.';

-- Partial index for the hot filter (WHERE excluded_from_recs = false)
CREATE INDEX bottles_included_idx ON public.bottles(id) WHERE excluded_from_recs = false;

-- 2. Backfill flag
UPDATE public.bottles
SET excluded_from_recs = true
WHERE name ~* '(barrel[ -]?sample|en primeur|futures|cask sample|tank sample)';

-- 3. Retire any active canon_wines row pointing at now-excluded bottles
-- (0 rows expected today; ships as durable cleanup.)
UPDATE public.canon_wines cw
SET replaced_at = now()
WHERE cw.replaced_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.bottles b
    WHERE b.id = cw.bottle_id AND b.excluded_from_recs = true
  );

-- 4. Extend the tier-validation trigger to reject excluded bottles.
-- Uses a sentinel prefix the client can detect for the friendly message.
CREATE OR REPLACE FUNCTION public.canon_wines_validate_tier()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  s int;
  is_excluded boolean;
BEGIN
  IF NEW.tier IS NULL THEN
    RAISE EXCEPTION 'canon_wines.tier is required (canon or nemesis)';
  END IF;
  IF NEW.tier NOT IN ('canon','nemesis') THEN
    RAISE EXCEPTION 'canon_wines.tier must be canon or nemesis, got %', NEW.tier;
  END IF;
  SELECT stars INTO s FROM public.ratings WHERE id = NEW.rating_id;
  IF s IS NULL THEN
    RAISE EXCEPTION 'canon_wines.rating_id % has no matching rating', NEW.rating_id;
  END IF;
  IF NEW.tier = 'canon' AND s < 5 THEN
    RAISE EXCEPTION 'Only 5-star ratings can become a Canon (got % stars)', s;
  END IF;
  IF NEW.tier = 'nemesis' AND s > 2 THEN
    RAISE EXCEPTION 'Only 1-2 star ratings can become a Nemesis (got % stars)', s;
  END IF;
  SELECT excluded_from_recs INTO is_excluded FROM public.bottles WHERE id = NEW.bottle_id;
  IF is_excluded THEN
    RAISE EXCEPTION 'EXCLUDED_BOTTLE: Barrel samples can''t be benchmarks — crown the finished wine instead.';
  END IF;
  RETURN NEW;
END $$;

-- 5. Filter recommendation pool RPC to exclude flagged rows.
CREATE OR REPLACE FUNCTION public.rpc_pour_candidates(
  loved jsonb,
  rated_types text[],
  excluded_ids uuid[] DEFAULT ARRAY[]::uuid[],
  per_loved integer DEFAULT 40,
  per_type_critic integer DEFAULT 150,
  overall_cap integer DEFAULT 800
)
RETURNS TABLE(id uuid, name text, producer text, region text, grape text, vintage integer, type text, critic_score integer, price_band text, fp_fresh real, fp_acid real, fp_tannin real, fp_fruit_dark real, fp_ripe real, fp_oak real, fp_body real, fp_savory real, ax_body real, ax_fruit_char real, ax_tannin real, ax_acidity real, ax_sweet real, tasting_note text, source text, added_by uuid)
LANGUAGE plpgsql STABLE SET search_path TO 'public', 'extensions' AS $$
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
  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(loved, '[]'::jsonb))
  LOOP
    EXIT WHEN loved_count >= 20 OR total >= overall_cap;
    loved_count := loved_count + 1;
    loved_type := lower(l->>'type');
    loved_vec := ARRAY[
      (l->>'fresh')::float,(l->>'acid')::float,(l->>'tannin')::float,
      (l->>'fruit_dark')::float,(l->>'ripe')::float,(l->>'oak')::float,
      (l->>'body')::float,(l->>'savory')::float
    ]::extensions.vector;
    remaining := overall_cap - total;

    SELECT array_agg(x.id) INTO batch_ids FROM (
      SELECT b.id FROM public.bottles b
      WHERE lower(coalesce(b.type,'')) = loved_type
        AND b.fp_vec IS NOT NULL
        AND b.excluded_from_recs = false
        AND NOT (b.id = ANY(seen))
      ORDER BY b.fp_vec OPERATOR(extensions.<->) loved_vec
      LIMIT least(per_loved, remaining)
    ) x;

    IF batch_ids IS NOT NULL AND array_length(batch_ids, 1) > 0 THEN
      seen := seen || batch_ids;
      total := total + array_length(batch_ids, 1);
      RETURN QUERY
      SELECT b.id, b.name, b.producer, b.region, b.grape, b.vintage, b.type,
        b.critic_score, b.price_band,
        b.fp_fresh, b.fp_acid, b.fp_tannin, b.fp_fruit_dark,
        b.fp_ripe, b.fp_oak, b.fp_body, b.fp_savory,
        b.ax_body, b.ax_fruit_char, b.ax_tannin, b.ax_acidity, b.ax_sweet,
        b.tasting_note, b.source, b.added_by
      FROM public.bottles b WHERE b.id = ANY(batch_ids);
    END IF;
  END LOOP;

  FOREACH t IN ARRAY coalesce(rated_types, ARRAY[]::text[])
  LOOP
    EXIT WHEN total >= overall_cap;
    remaining := overall_cap - total;
    SELECT array_agg(x.id) INTO batch_ids FROM (
      SELECT b.id FROM public.bottles b
      WHERE lower(coalesce(b.type,'')) = lower(t)
        AND b.critic_score IS NOT NULL
        AND b.excluded_from_recs = false
        AND NOT (b.id = ANY(seen))
      ORDER BY b.critic_score DESC NULLS LAST
      LIMIT least(per_type_critic, remaining)
    ) x;

    IF batch_ids IS NOT NULL AND array_length(batch_ids, 1) > 0 THEN
      seen := seen || batch_ids;
      total := total + array_length(batch_ids, 1);
      RETURN QUERY
      SELECT b.id, b.name, b.producer, b.region, b.grape, b.vintage, b.type,
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

-- 6. Filter fuzzy search RPC (scan matching + add-bottle autocomplete)
-- to exclude flagged rows. When a scanned line best-matches an excluded row,
-- the parent cuvée (if it exists at same producer) surfaces naturally in the
-- top-N candidates; otherwise the caller falls through to the estimated
-- fingerprint path.
CREATE OR REPLACE FUNCTION public.search_bottles_fuzzy(
  q text,
  type_variants text[] DEFAULT NULL::text[],
  lim integer DEFAULT 50,
  threshold real DEFAULT 0.3
)
RETURNS SETOF bottles
LANGUAGE sql STABLE SET search_path TO 'public', 'extensions' AS $$
  SELECT b.*
  FROM public.bottles b
  WHERE (type_variants IS NULL OR b.type = ANY(type_variants))
    AND b.excluded_from_recs = false
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