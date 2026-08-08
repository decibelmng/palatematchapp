ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS reservation_url text,
  ADD COLUMN IF NOT EXISTS neighborhood text;

ALTER TABLE public.ratings
  ADD COLUMN IF NOT EXISTS photo_path text,
  ADD COLUMN IF NOT EXISTS photo_shared boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.restaurant_saves (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, restaurant_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_saves TO authenticated;
GRANT ALL ON public.restaurant_saves TO service_role;

ALTER TABLE public.restaurant_saves ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'restaurant_saves'
      AND policyname = 'Users manage their own saved restaurants'
  ) THEN
    CREATE POLICY "Users manage their own saved restaurants"
      ON public.restaurant_saves FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;