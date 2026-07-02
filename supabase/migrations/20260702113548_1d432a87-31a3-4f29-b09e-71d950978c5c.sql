
-- 1. Extend scan_logs with restaurant attribution, stored image paths, and status
ALTER TABLE public.scan_logs
  ADD COLUMN IF NOT EXISTS restaurant_id uuid,
  ADD COLUMN IF NOT EXISTS image_paths text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'parsed';

ALTER TABLE public.scan_logs
  DROP CONSTRAINT IF EXISTS scan_logs_status_check;
ALTER TABLE public.scan_logs
  ADD CONSTRAINT scan_logs_status_check CHECK (status IN ('parsed','failed'));

-- 2. Bottles: allow marking as unverified (community-added from scans)
ALTER TABLE public.bottles
  ADD COLUMN IF NOT EXISTS unverified boolean NOT NULL DEFAULT false;

-- 3. Restaurants
CREATE TABLE IF NOT EXISTS public.restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text,
  locale text,
  google_place_id text UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS restaurants_name_trgm
  ON public.restaurants USING gin (name extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS restaurants_city_idx ON public.restaurants (city);

GRANT SELECT ON public.restaurants TO anon, authenticated;
GRANT INSERT, UPDATE ON public.restaurants TO authenticated;
GRANT ALL ON public.restaurants TO service_role;

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Restaurants are publicly readable"
  ON public.restaurants FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create restaurants"
  ON public.restaurants FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Creators can edit their restaurants"
  ON public.restaurants FOR UPDATE TO authenticated
  USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);

-- 4. Restaurant wines (the wine-list graph)
CREATE TABLE IF NOT EXISTS public.restaurant_wines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  bottle_id uuid NOT NULL REFERENCES public.bottles(id) ON DELETE CASCADE,
  menu_price text,
  menu_price_amount numeric,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  seen_count integer NOT NULL DEFAULT 1,
  source_scan_id uuid REFERENCES public.scan_logs(id) ON DELETE SET NULL,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (restaurant_id, bottle_id)
);
CREATE INDEX IF NOT EXISTS restaurant_wines_restaurant_idx
  ON public.restaurant_wines (restaurant_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS restaurant_wines_bottle_idx
  ON public.restaurant_wines (bottle_id);

GRANT SELECT ON public.restaurant_wines TO anon, authenticated;
GRANT INSERT, UPDATE ON public.restaurant_wines TO authenticated;
GRANT ALL ON public.restaurant_wines TO service_role;

ALTER TABLE public.restaurant_wines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Restaurant wines are publicly readable"
  ON public.restaurant_wines FOR SELECT USING (true);
-- Writes always go through server functions, but keep sane per-user policies
CREATE POLICY "Authenticated users can insert restaurant wines"
  ON public.restaurant_wines FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = added_by);
CREATE POLICY "Authenticated users can update restaurant wines"
  ON public.restaurant_wines FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

-- 5. Restaurant search RPC (fuzzy + optional city)
CREATE OR REPLACE FUNCTION public.search_restaurants(q text, lim integer DEFAULT 10)
RETURNS TABLE (id uuid, name text, city text, locale text)
LANGUAGE sql STABLE SET search_path = public, extensions
AS $$
  SELECT r.id, r.name, r.city, r.locale
  FROM public.restaurants r
  WHERE
    r.name ILIKE q || '%'
    OR r.name ILIKE '%' || q || '%'
    OR word_similarity(lower(q), lower(r.name)) >= 0.3
  ORDER BY
    CASE WHEN r.name ILIKE q || '%' THEN 0 ELSE 1 END,
    r.name
  LIMIT least(coalesce(lim, 10), 25);
$$;

GRANT EXECUTE ON FUNCTION public.search_restaurants(text, integer) TO anon, authenticated;
