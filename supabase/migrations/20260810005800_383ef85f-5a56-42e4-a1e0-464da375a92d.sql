CREATE OR REPLACE FUNCTION public.refingerprint_v3_schedule(v_job_name text, v_schedule text DEFAULT '* * * * *')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_sql text;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = v_job_name) THEN
    PERFORM cron.unschedule(v_job_name);
  END IF;

  v_sql := $cmd$
    SELECT net.http_post(
      url := 'https://project--9cc31ff4-ecd2-451d-b227-b30e28e87f43-dev.lovable.app/api/public/hooks/refingerprint-v3',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_uBdGKhTkSyYWE3SJQXa-PA_wAxapy9_'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cmd$;

  PERFORM cron.schedule(v_job_name, v_schedule, v_sql);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.refingerprint_v3_schedule(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refingerprint_v3_schedule(text, text) TO service_role;

DO $$ BEGIN PERFORM public.refingerprint_v3_schedule('refingerprint-v3-main-queue', '* * * * *'); END $$;