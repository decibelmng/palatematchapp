
ALTER TABLE public.canon_wines
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'canon'
    CHECK (tier IN ('canon','nemesis'));

DROP INDEX IF EXISTS public.canon_wines_one_active;

CREATE UNIQUE INDEX canon_wines_one_active
  ON public.canon_wines(user_id, region_key, wine_type, tier)
  WHERE replaced_at IS NULL;
