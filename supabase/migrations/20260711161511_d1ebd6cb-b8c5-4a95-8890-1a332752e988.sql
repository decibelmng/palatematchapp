
CREATE TABLE public.canon_wines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating_id uuid NOT NULL REFERENCES public.ratings(id) ON DELETE CASCADE,
  bottle_id uuid NOT NULL REFERENCES public.bottles(id) ON DELETE CASCADE,
  region text NOT NULL,
  region_key text GENERATED ALWAYS AS (lower(btrim(region))) STORED,
  wine_type text NOT NULL CHECK (wine_type IN ('red','white','rose','sparkling','dessert')),
  created_at timestamptz NOT NULL DEFAULT now(),
  replaced_at timestamptz
);

CREATE UNIQUE INDEX canon_wines_one_active
  ON public.canon_wines(user_id, region_key, wine_type)
  WHERE replaced_at IS NULL;

CREATE INDEX canon_wines_user_active_idx
  ON public.canon_wines(user_id)
  WHERE replaced_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.canon_wines TO authenticated;
GRANT ALL ON public.canon_wines TO service_role;

ALTER TABLE public.canon_wines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own canons"
  ON public.canon_wines
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
