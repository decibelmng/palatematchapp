-- 1) profiles.onboarding_stage (existing users → 'done')
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_stage TEXT NOT NULL DEFAULT 'done'
  CHECK (onboarding_stage IN ('intro','rate5','done'));

-- Handle brand-new users: switch handle_new_user to seed 'intro'.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, username, onboarding_stage)
  VALUES (
    NEW.id,
    'user_' || substr(replace(NEW.id::text, '-', ''), 1, 8),
    'intro'
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $function$;

-- 2) price_observations
CREATE TABLE IF NOT EXISTS public.price_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  bottle_id UUID REFERENCES public.bottles(id) ON DELETE SET NULL,
  cuvee_key TEXT,
  raw_line TEXT,
  menu_price NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scan_id UUID,
  user_id UUID NOT NULL DEFAULT auth.uid(),
  source TEXT NOT NULL CHECK (source IN ('ocr','user_corrected')),
  superseded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.price_observations TO authenticated;
GRANT ALL ON public.price_observations TO service_role;

ALTER TABLE public.price_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own price obs"
  ON public.price_observations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "owner writes own price obs"
  ON public.price_observations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "owner updates own price obs"
  ON public.price_observations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS price_obs_restaurant_cuvee_idx
  ON public.price_observations (restaurant_id, cuvee_key, observed_at DESC)
  WHERE superseded = false;

-- 3) Aggregate RPCs (SECURITY DEFINER; return non-PII data only)
CREATE OR REPLACE FUNCTION public.restaurant_price_stats(p_restaurant_id UUID)
RETURNS TABLE(observation_count INTEGER, median_menu_price NUMERIC, last_observed_at TIMESTAMPTZ)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COUNT(*)::int AS observation_count,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY menu_price)::numeric AS median_menu_price,
    MAX(observed_at) AS last_observed_at
  FROM public.price_observations
  WHERE restaurant_id = p_restaurant_id
    AND superseded = false;
$$;

CREATE OR REPLACE FUNCTION public.restaurant_cuvee_history(p_restaurant_id UUID, p_cuvee_key TEXT)
RETURNS TABLE(menu_price NUMERIC, observed_at TIMESTAMPTZ, source TEXT)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT menu_price, observed_at, source
  FROM public.price_observations
  WHERE restaurant_id = p_restaurant_id
    AND cuvee_key = lower(trim(p_cuvee_key))
    AND superseded = false
  ORDER BY observed_at DESC
  LIMIT 25;
$$;

GRANT EXECUTE ON FUNCTION public.restaurant_price_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restaurant_cuvee_history(UUID, TEXT) TO authenticated;