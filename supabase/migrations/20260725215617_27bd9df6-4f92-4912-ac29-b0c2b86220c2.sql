
-- Part 1: scans additions
ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS venue_raw_text text,
  ADD COLUMN IF NOT EXISTS scanned_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS share_token text UNIQUE;

-- scan_wines additions
ALTER TABLE public.scan_wines
  ADD COLUMN IF NOT EXISTS raw_text text,
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'bottle',
  ADD COLUMN IF NOT EXISTS price_amount numeric,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

ALTER TABLE public.scan_wines
  DROP CONSTRAINT IF EXISTS scan_wines_format_chk;
ALTER TABLE public.scan_wines
  ADD CONSTRAINT scan_wines_format_chk CHECK (format IN ('bottle','glass','half'));

-- restaurants additions
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS venue_raw_text_last text,
  ADD COLUMN IF NOT EXISTS possible_duplicate boolean NOT NULL DEFAULT false;

-- price_observations format tag
ALTER TABLE public.price_observations
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'bottle';
ALTER TABLE public.price_observations
  DROP CONSTRAINT IF EXISTS price_observations_format_chk;
ALTER TABLE public.price_observations
  ADD CONSTRAINT price_observations_format_chk CHECK (format IN ('bottle','glass','half'));

-- profiles seam for future reservation handoff
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS palate_shareable boolean NOT NULL DEFAULT false;

-- Indexes
CREATE INDEX IF NOT EXISTS scan_wines_scan_id_idx ON public.scan_wines(scan_id);
CREATE INDEX IF NOT EXISTS scans_user_scanned_at_idx ON public.scans(user_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS scans_share_token_idx ON public.scans(share_token) WHERE share_token IS NOT NULL;

-- Public share read policy on scans (only when share_token is set)
DROP POLICY IF EXISTS "scans_share_public_read" ON public.scans;
CREATE POLICY "scans_share_public_read" ON public.scans
  FOR SELECT
  TO anon, authenticated
  USING (share_token IS NOT NULL);

-- Public share read on scan_wines when parent scan is shared
DROP POLICY IF EXISTS "scan_wines_shared_read" ON public.scan_wines;
CREATE POLICY "scan_wines_shared_read" ON public.scan_wines
  FOR SELECT
  TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.scans s
    WHERE s.id = scan_wines.scan_id AND s.share_token IS NOT NULL
  ));

GRANT SELECT ON public.scans TO anon;
GRANT SELECT ON public.scan_wines TO anon;
GRANT SELECT ON public.restaurants TO anon;

-- ============================================================================
-- Part 3: admin accumulation dashboard RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_capture_summary(p_min_obs integer DEFAULT 5)
RETURNS TABLE(
  total_restaurants bigint,
  total_listings bigint,
  total_price_obs bigint,
  restaurants_with_min_obs bigint,
  possible_duplicates bigint,
  scans_this_week bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::bigint FROM public.restaurants),
    (SELECT COUNT(*)::bigint FROM public.restaurant_wines),
    (SELECT COUNT(*)::bigint FROM public.price_observations WHERE superseded = false),
    (SELECT COUNT(*)::bigint FROM (
       SELECT restaurant_id FROM public.price_observations
       WHERE superseded = false
       GROUP BY restaurant_id
       HAVING COUNT(*) >= GREATEST(p_min_obs, 1)
     ) t),
    (SELECT COUNT(*)::bigint FROM public.restaurants WHERE possible_duplicate = true),
    (SELECT COUNT(*)::bigint FROM public.scans WHERE created_at > now() - interval '7 days');
$$;

CREATE OR REPLACE FUNCTION public.admin_restaurant_coverage(p_limit integer DEFAULT 500)
RETURNS TABLE(
  id uuid,
  name text,
  city text,
  possible_duplicate boolean,
  venue_raw_text_last text,
  listings bigint,
  price_obs bigint,
  first_seen timestamptz,
  last_seen timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id, r.name, r.city, r.possible_duplicate, r.venue_raw_text_last,
    COALESCE((SELECT COUNT(*) FROM public.restaurant_wines rw WHERE rw.restaurant_id = r.id), 0)::bigint,
    COALESCE((SELECT COUNT(*) FROM public.price_observations po WHERE po.restaurant_id = r.id AND po.superseded = false), 0)::bigint,
    (SELECT MIN(po.observed_at) FROM public.price_observations po WHERE po.restaurant_id = r.id),
    (SELECT MAX(po.observed_at) FROM public.price_observations po WHERE po.restaurant_id = r.id)
  FROM public.restaurants r
  ORDER BY r.created_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 2000);
$$;

REVOKE ALL ON FUNCTION public.admin_capture_summary(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_restaurant_coverage(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_capture_summary(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_restaurant_coverage(integer) TO service_role;
