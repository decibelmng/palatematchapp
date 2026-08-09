CREATE TABLE public.write_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target_table text NOT NULL,
  operation text NOT NULL DEFAULT 'insert',
  message text,
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.write_failures TO authenticated;
GRANT ALL ON public.write_failures TO service_role;

ALTER TABLE public.write_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can log their own write failures"
  ON public.write_failures FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read write failures"
  ON public.write_failures FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX write_failures_table_time_idx
  ON public.write_failures (target_table, created_at DESC);

-- Advance the retry counter for every row in a cuvée group, not just the seed.
-- Sibling rows previously stayed at 0 attempts, so a group that fails for a
-- structural reason could be retried forever through a different seed.
CREATE OR REPLACE FUNCTION public.bump_fingerprint_attempts(_ids uuid[])
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH upd AS (
    UPDATE public.bottles
       SET fingerprint_attempts = COALESCE(fingerprint_attempts, 0) + 1,
           last_attempt_at = now()
     WHERE id = ANY(_ids)
       AND refingerprinted_at IS NULL
    RETURNING 1
  )
  SELECT COALESCE(count(*), 0)::int FROM upd;
$$;

REVOKE ALL ON FUNCTION public.bump_fingerprint_attempts(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.bump_fingerprint_attempts(uuid[]) TO service_role;

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
         'matched scan wines with a price',
         (SELECT count(*) FROM public.scan_wines WHERE price_amount IS NOT NULL AND matched_bottle_id IS NOT NULL)
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
  SELECT 'call_instrumentation', (SELECT count(*) FROM public.call_instrumentation),
         (SELECT max(created_at) FROM public.call_instrumentation),
         'completed scans', (SELECT count(*) FROM public.scans WHERE status IN ('complete','partial'))
  WHERE public.has_role(auth.uid(), 'admin')
  UNION ALL
  SELECT 'scan_wines.predicted_stars', (SELECT count(*) FROM public.scan_wines WHERE predicted_stars IS NOT NULL),
         (SELECT max(created_at) FROM public.scan_wines WHERE predicted_stars IS NOT NULL),
         'scan wines matched to a bottle', (SELECT count(*) FROM public.scan_wines WHERE matched_bottle_id IS NOT NULL)
  WHERE public.has_role(auth.uid(), 'admin')
  UNION ALL
  SELECT 'profiles with a real palate code',
         (SELECT count(*) FROM public.profiles WHERE palate_code_red <> 'XXXXX' OR palate_code_white <> 'XXXXX'),
         (SELECT max(updated_at) FROM public.profiles),
         'profiles with ratings',
         (SELECT count(DISTINCT user_id) FROM public.ratings)
  WHERE public.has_role(auth.uid(), 'admin')
  UNION ALL
  SELECT 'bottles missing a style reading',
         (SELECT count(*) FROM public.bottles WHERE refingerprinted_at IS NULL AND fingerprint_attempts > 0),
         (SELECT max(last_attempt_at) FROM public.bottles),
         'bottles attempted at least once',
         (SELECT count(*) FROM public.bottles WHERE fingerprint_attempts > 0)
  WHERE public.has_role(auth.uid(), 'admin')
  UNION ALL
  SELECT 'write_failures (lost rows)', (SELECT count(*) FROM public.write_failures),
         (SELECT max(created_at) FROM public.write_failures),
         'logged failures across all tables', (SELECT count(*) FROM public.write_failures)
  WHERE public.has_role(auth.uid(), 'admin')
  UNION ALL
  SELECT 'scans stuck in processing', (SELECT count(*) FROM public.scans WHERE status = 'processing'),
         (SELECT max(updated_at) FROM public.scans WHERE status = 'processing'),
         'all scans', (SELECT count(*) FROM public.scans)
  WHERE public.has_role(auth.uid(), 'admin');
$$;

REVOKE ALL ON FUNCTION public.admin_data_integrity() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_data_integrity() TO authenticated;