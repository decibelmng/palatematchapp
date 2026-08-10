CREATE OR REPLACE FUNCTION public.refingerprint_v3_write_batch(v_job_id uuid, v_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_written int := 0;
  v_thin int := 0;
  v_empty int := 0;
  v_ambiguous int := 0;
  v_prev jsonb;
  v_recent jsonb;
  v_w1 bigint := 0;
  v_w5 bigint := 0;
  v_snapshot jsonb;
BEGIN
  WITH src AS (
    SELECT * FROM jsonb_to_recordset(v_rows) AS x(
      id uuid, pipeline text, axes_read int,
      fresh real, acid real, tannin real, fruit_dark real,
      ripe real, oak real, body real, savory real
    )
  ), upd AS (
    UPDATE public.bottles b SET
      fp_v3_scored_at = v_now,
      fp_v3_job_id = v_job_id,
      fp_v3_axes_read = s.axes_read,
      fp_v3_pipeline = s.pipeline,
      fp_fresh_v3 = s.fresh,
      fp_acid_v3 = s.acid,
      fp_tannin_v3 = s.tannin,
      fp_fruit_dark_v3 = s.fruit_dark,
      fp_ripe_v3 = s.ripe,
      fp_oak_v3 = s.oak,
      fp_body_v3 = s.body,
      fp_savory_v3 = s.savory
    FROM src s
    WHERE b.id = s.id AND b.fp_v3_scored_at IS NULL
    RETURNING s.axes_read AS axes_read, s.pipeline AS pipeline
  )
  SELECT count(*),
         count(*) FILTER (WHERE axes_read <= 3),
         count(*) FILTER (WHERE axes_read = 0),
         count(*) FILTER (WHERE pipeline = 'note_v3_ambiguous_join')
    INTO v_written, v_thin, v_empty, v_ambiguous
  FROM upd;

  SELECT coalesce(snapshot, '{}'::jsonb) INTO v_prev
  FROM public.catalog_progress_cache WHERE job_id = v_job_id;
  v_prev := coalesce(v_prev, '{}'::jsonb);

  v_recent := coalesce(v_prev->'recent', '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('t', v_now, 'n', v_written));
  SELECT coalesce(jsonb_agg(e), '[]'::jsonb) INTO v_recent
  FROM jsonb_array_elements(v_recent) e
  WHERE (e->>'t')::timestamptz >= v_now - interval '5 minutes';

  SELECT coalesce(sum((e->>'n')::bigint) FILTER (WHERE (e->>'t')::timestamptz >= v_now - interval '1 minute'), 0),
         coalesce(sum((e->>'n')::bigint), 0)
    INTO v_w1, v_w5
  FROM jsonb_array_elements(v_recent) e;

  v_snapshot := v_prev || jsonb_build_object(
    'scored', coalesce((v_prev->>'scored')::bigint, 0) + v_written,
    'pending', greatest(coalesce((v_prev->>'pending')::bigint, 0) - v_written, 0),
    'thin', coalesce((v_prev->>'thin')::bigint, 0) + v_thin,
    'empty', coalesce((v_prev->>'empty')::bigint, 0) + v_empty,
    'ambiguous', coalesce((v_prev->>'ambiguous')::bigint, 0) + v_ambiguous,
    'wrote1m', v_w1,
    'wrote5m', v_w5,
    'rowsPerSecond', round(v_w5::numeric / 300.0, 3),
    'lastWriteAt', v_now,
    'recent', v_recent
  );

  INSERT INTO public.catalog_progress_cache (job_id, snapshot, updated_at)
  VALUES (v_job_id, v_snapshot, v_now)
  ON CONFLICT (job_id) DO UPDATE
    SET snapshot = EXCLUDED.snapshot, updated_at = v_now;

  RETURN jsonb_build_object(
    'written', v_written,
    'thin', v_thin,
    'empty', v_empty,
    'ambiguous', v_ambiguous,
    'pending', v_snapshot->'pending'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.refingerprint_v3_write_batch(uuid, jsonb) TO service_role;

INSERT INTO public.catalog_progress_cache (job_id, snapshot, updated_at)
VALUES (
  'fcf3b92a-0700-4a85-82a4-7d0d6b5af2a9',
  jsonb_build_object(
    'scored', 113161, 'pending', 5675, 'thin', 0, 'empty', 0, 'ambiguous', 0,
    'wrote1m', 0, 'wrote5m', 0, 'rowsPerSecond', 0,
    'lastWriteAt', NULL, 'recent', '[]'::jsonb, 'seeded', true
  ),
  now()
)
ON CONFLICT (job_id) DO NOTHING;