CREATE TABLE IF NOT EXISTS public.catalog_progress_cache (
  job_id uuid PRIMARY KEY,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.catalog_progress_cache TO authenticated;
GRANT ALL ON public.catalog_progress_cache TO service_role;
ALTER TABLE public.catalog_progress_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "no direct client access" ON public.catalog_progress_cache;
CREATE POLICY "no direct client access" ON public.catalog_progress_cache FOR SELECT TO authenticated USING (false);

CREATE OR REPLACE FUNCTION public.refingerprint_v3_refresh_progress(v_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_paused boolean;
BEGIN
  SELECT coalesce(position('[v3 cron paused]' in coalesce(j.note, '')) > 0, false)
    INTO v_paused
  FROM public.catalog_jobs j
  WHERE j.id = v_job_id;

  SELECT jsonb_build_object(
    'scored', count(*) FILTER (WHERE b.fp_v3_scored_at IS NOT NULL),
    'pending', count(*) FILTER (
      WHERE b.fp_v3_scored_at IS NULL
        AND EXISTS (SELECT 1 FROM public.catalog_source_notes n WHERE n.bottle_id = b.id)
    ),
    'thin', count(*) FILTER (WHERE b.fp_v3_scored_at IS NOT NULL AND b.fp_v3_axes_read <= 3),
    'empty', count(*) FILTER (WHERE b.fp_v3_scored_at IS NOT NULL AND b.fp_v3_axes_read = 0),
    'ambiguous', count(*) FILTER (WHERE b.fp_v3_pipeline = 'note_v3_ambiguous_join'),
    'wrote1m', count(*) FILTER (WHERE b.fp_v3_scored_at >= now() - interval '1 minute'),
    'wrote5m', count(*) FILTER (WHERE b.fp_v3_scored_at >= now() - interval '5 minutes'),
    'lastWriteAt', max(b.fp_v3_scored_at)
  )
  INTO v_snapshot
  FROM public.bottles b;

  v_snapshot := v_snapshot
    || jsonb_build_object(
         'paused', coalesce(v_paused, false),
         'rowsPerSecond', round(((v_snapshot->>'wrote5m')::numeric / 300.0), 3)
       );

  INSERT INTO public.catalog_progress_cache (job_id, snapshot, updated_at)
  VALUES (v_job_id, v_snapshot, now())
  ON CONFLICT (job_id) DO UPDATE
    SET snapshot = EXCLUDED.snapshot, updated_at = now();

  RETURN v_snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION public.refingerprint_v3_pending_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
  FROM public.bottles b
  WHERE b.fp_v3_scored_at IS NULL
    AND EXISTS (SELECT 1 FROM public.catalog_source_notes n WHERE n.bottle_id = b.id);
$$;

CREATE OR REPLACE FUNCTION public.refingerprint_v3_unschedule(v_job_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = v_job_name) THEN
    PERFORM cron.unschedule(v_job_name);
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.refingerprint_v3_refresh_progress(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refingerprint_v3_pending_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refingerprint_v3_unschedule(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refingerprint_v3_refresh_progress(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.refingerprint_v3_pending_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.refingerprint_v3_unschedule(text) TO service_role;