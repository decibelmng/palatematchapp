CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.admin_data_integrity()
RETURNS TABLE (
  derived_table text,
  row_count bigint,
  last_write timestamptz,
  parent_label text,
  parent_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'restaurant_wines', (SELECT count(*) FROM public.restaurant_wines),
         (SELECT max(last_seen_at) FROM public.restaurant_wines),
         'scans with a restaurant', (SELECT count(*) FROM public.scans WHERE restaurant_id IS NOT NULL)
  WHERE public.has_role(auth.uid(), 'admin')
  UNION ALL
  SELECT 'price_observations', (SELECT count(*) FROM public.price_observations),
         (SELECT max(created_at) FROM public.price_observations),
         'scan wines with a price', (SELECT count(*) FROM public.scan_wines WHERE price_amount IS NOT NULL)
  WHERE public.has_role(auth.uid(), 'admin')
  UNION ALL
  SELECT 'prediction_outcomes', (SELECT count(*) FROM public.prediction_outcomes),
         (SELECT max(created_at) FROM public.prediction_outcomes),
         'ratings', (SELECT count(*) FROM public.ratings)
  WHERE public.has_role(auth.uid(), 'admin')
  UNION ALL
  SELECT 'scan_outcomes', (SELECT count(*) FROM public.scan_outcomes),
         (SELECT max(created_at) FROM public.scan_outcomes),
         'completed scans', (SELECT count(*) FROM public.scans WHERE status IN ('complete','partial'))
  WHERE public.has_role(auth.uid(), 'admin')
  UNION ALL
  SELECT 'scan_wines.predicted_stars', (SELECT count(*) FROM public.scan_wines WHERE predicted_stars IS NOT NULL),
         (SELECT max(created_at) FROM public.scan_wines WHERE predicted_stars IS NOT NULL),
         'scan wines matched to a bottle', (SELECT count(*) FROM public.scan_wines WHERE matched_bottle_id IS NOT NULL)
  WHERE public.has_role(auth.uid(), 'admin')
  UNION ALL
  SELECT 'scans stuck in processing', (SELECT count(*) FROM public.scans WHERE status = 'processing'),
         (SELECT max(updated_at) FROM public.scans WHERE status = 'processing'),
         'all scans', (SELECT count(*) FROM public.scans)
  WHERE public.has_role(auth.uid(), 'admin');
$$;

REVOKE ALL ON FUNCTION public.admin_data_integrity() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_data_integrity() TO authenticated;