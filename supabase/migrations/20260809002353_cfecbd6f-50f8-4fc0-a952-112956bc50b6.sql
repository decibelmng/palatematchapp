-- When each write path's WRITER shipped. Not when the column or table appeared:
-- restaurant_wines and price_observations both existed for weeks while the
-- writer targeted the wrong table, so the table's age would exonerate a path
-- that was never working.
CREATE TABLE public.write_path_ships (
  path text PRIMARY KEY,
  shipped_at date NOT NULL,
  note text
);

GRANT SELECT ON public.write_path_ships TO authenticated;
GRANT ALL ON public.write_path_ships TO service_role;

ALTER TABLE public.write_path_ships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read ship dates"
  ON public.write_path_ships FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.write_path_ships (path, shipped_at, note) VALUES
  ('restaurant_wines', '2026-08-08', 'Table existed 2026-07-02, but the writer targeted scan_logs until the venue-capture repair'),
  ('price_observations', '2026-08-08', 'Table existed 2026-07-17; same wrong-table writer as restaurant_wines'),
  ('prediction_outcomes', '2026-08-08', 'Outcome logging added to the rating cascade'),
  ('scan_outcomes', '2026-08-08', '"I ordered this" capture'),
  ('call_instrumentation', '2026-08-08', 'Call shape logging on the verdict screen'),
  ('scan_wines.predicted_stars', '2026-08-08', 'Column existed 2026-07-02; finalize only began writing it on this date'),
  ('profiles with a real palate code', '2026-08-08', 'Server-side recompute replaced the client effect'),
  ('bottles missing a style reading', '2026-08-08', 'Per-row eligibility plus the attempt ceiling'),
  ('write_failures (lost rows)', '2026-08-09', 'Instrumentation failure log');

DROP FUNCTION IF EXISTS public.admin_data_integrity();

CREATE OR REPLACE FUNCTION public.admin_data_integrity(_since timestamptz DEFAULT now() - interval '7 days')
RETURNS TABLE (
  derived_table text,
  row_count bigint,
  last_write timestamptz,
  parent_label text,
  parent_count bigint,
  shipped_at date,
  window_from timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := COALESCE(_since, '-infinity'::timestamptz);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH ships AS (SELECT s.path, s.shipped_at FROM public.write_path_ships s),
  -- A path is judged only on rows created after it existed. The effective
  -- floor is the later of the requested window and the path's ship date.
  f AS (
    SELECT s.path,
           s.shipped_at,
           GREATEST(v_since, s.shipped_at::timestamptz) AS floor_at
      FROM ships s
  )
  SELECT * FROM (
    SELECT 'restaurant_wines'::text,
           (SELECT count(*) FROM public.restaurant_wines rw WHERE rw.first_seen_at >= f.floor_at),
           (SELECT max(rw.last_seen_at) FROM public.restaurant_wines rw),
           'scans with a restaurant, finished in window'::text,
           (SELECT count(*) FROM public.scans s
             WHERE s.restaurant_id IS NOT NULL
               AND s.status IN ('complete','partial')
               AND s.created_at >= f.floor_at),
           f.shipped_at, f.floor_at
      FROM f WHERE f.path = 'restaurant_wines'

    UNION ALL
    -- Denominator was previously unnumbered AND unscoped: it counted every
    -- priced+matched wine ever parsed, including wines from scans that never
    -- finished and so could not have produced a price observation.
    SELECT 'price_observations'::text,
           (SELECT count(*) FROM public.price_observations po WHERE po.created_at >= f.floor_at),
           (SELECT max(po.created_at) FROM public.price_observations po),
           'priced+matched wines on finished scans in window'::text,
           (SELECT count(*) FROM public.scan_wines sw
              JOIN public.scans s ON s.id = sw.scan_id
             WHERE sw.price_amount IS NOT NULL
               AND sw.matched_bottle_id IS NOT NULL
               AND s.status IN ('complete','partial')
               AND sw.created_at >= f.floor_at),
           f.shipped_at, f.floor_at
      FROM f WHERE f.path = 'price_observations'

    UNION ALL
    SELECT 'prediction_outcomes'::text,
           (SELECT count(*) FROM public.prediction_outcomes po WHERE po.created_at >= f.floor_at),
           (SELECT max(po.created_at) FROM public.prediction_outcomes po),
           'ratings saved in window'::text,
           (SELECT count(*) FROM public.ratings r WHERE r.created_at >= f.floor_at),
           f.shipped_at, f.floor_at
      FROM f WHERE f.path = 'prediction_outcomes'

    UNION ALL
    SELECT 'scan_outcomes'::text,
           (SELECT count(*) FROM public.scan_outcomes so WHERE so.created_at >= f.floor_at),
           (SELECT max(so.created_at) FROM public.scan_outcomes so),
           'scans finished in window'::text,
           (SELECT count(*) FROM public.scans s
             WHERE s.status IN ('complete','partial') AND s.created_at >= f.floor_at),
           f.shipped_at, f.floor_at
      FROM f WHERE f.path = 'scan_outcomes'

    UNION ALL
    SELECT 'call_instrumentation'::text,
           (SELECT count(*) FROM public.call_instrumentation ci WHERE ci.created_at >= f.floor_at),
           (SELECT max(ci.created_at) FROM public.call_instrumentation ci),
           'scans finished in window'::text,
           (SELECT count(*) FROM public.scans s
             WHERE s.status IN ('complete','partial') AND s.created_at >= f.floor_at),
           f.shipped_at, f.floor_at
      FROM f WHERE f.path = 'call_instrumentation'

    UNION ALL
    -- Was "0 of 739": every matched wine ever, including the 739 that predate
    -- the finalize writer. Now only wines from scans finished in the window.
    SELECT 'scan_wines.predicted_stars'::text,
           (SELECT count(*) FROM public.scan_wines sw
              JOIN public.scans s ON s.id = sw.scan_id
             WHERE sw.predicted_stars IS NOT NULL
               AND s.status IN ('complete','partial')
               AND sw.created_at >= f.floor_at),
           (SELECT max(sw.created_at) FROM public.scan_wines sw WHERE sw.predicted_stars IS NOT NULL),
           'matched wines on finished scans in window'::text,
           (SELECT count(*) FROM public.scan_wines sw
              JOIN public.scans s ON s.id = sw.scan_id
             WHERE sw.matched_bottle_id IS NOT NULL
               AND s.status IN ('complete','partial')
               AND sw.created_at >= f.floor_at),
           f.shipped_at, f.floor_at
      FROM f WHERE f.path = 'scan_wines.predicted_stars'

    UNION ALL
    -- Palate codes are a current-state ratio, not an event stream: every
    -- profile with ratings should hold a code right now, whenever it rated.
    SELECT 'profiles with a real palate code'::text,
           (SELECT count(*) FROM public.profiles p
             WHERE (p.palate_code_red <> 'XXXXX' OR p.palate_code_white <> 'XXXXX')
               AND EXISTS (SELECT 1 FROM public.ratings r WHERE r.user_id = p.id)),
           (SELECT max(p.updated_at) FROM public.profiles p),
           'profiles with ratings (all time)'::text,
           (SELECT count(DISTINCT r.user_id) FROM public.ratings r),
           f.shipped_at, NULL::timestamptz
      FROM f WHERE f.path = 'profiles with a real palate code'

    UNION ALL
    SELECT 'bottles scored after an attempt'::text,
           (SELECT count(*) FROM public.bottles b
             WHERE b.refingerprinted_at >= f.floor_at),
           (SELECT max(b.refingerprinted_at) FROM public.bottles b),
           'bottles attempted in window'::text,
           (SELECT count(*) FROM public.bottles b
             WHERE b.last_attempt_at >= f.floor_at),
           f.shipped_at, f.floor_at
      FROM f WHERE f.path = 'bottles missing a style reading'

    UNION ALL
    SELECT 'write_failures (lost rows)'::text,
           (SELECT count(*) FROM public.write_failures wf WHERE wf.created_at >= f.floor_at),
           (SELECT max(wf.created_at) FROM public.write_failures wf),
           'failures logged in window'::text,
           (SELECT count(*) FROM public.write_failures wf WHERE wf.created_at >= f.floor_at),
           f.shipped_at, f.floor_at
      FROM f WHERE f.path = 'write_failures (lost rows)'

    UNION ALL
    SELECT 'scans stuck in processing'::text,
           (SELECT count(*) FROM public.scans s WHERE s.status = 'processing' AND s.created_at >= v_since),
           (SELECT max(s.updated_at) FROM public.scans s WHERE s.status = 'processing'),
           'scans started in window'::text,
           (SELECT count(*) FROM public.scans s WHERE s.created_at >= v_since),
           NULL::date, v_since
  ) q(derived_table, row_count, last_write, parent_label, parent_count, shipped_at, window_from);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_data_integrity(timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_data_integrity(timestamptz) TO authenticated;