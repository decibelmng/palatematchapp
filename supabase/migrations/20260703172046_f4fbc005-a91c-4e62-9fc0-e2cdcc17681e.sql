CREATE OR REPLACE FUNCTION public.mark_scan_batch_done(p_scan_id uuid, p_batch_index int)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.scans
  SET batches_done = batches_done + 1,
      batches_failed = coalesce(
        (SELECT jsonb_agg(e) FROM jsonb_array_elements(batches_failed) e
         WHERE (e)::int <> p_batch_index),
        '[]'::jsonb)
  WHERE id = p_scan_id;
$$;

CREATE OR REPLACE FUNCTION public.mark_scan_batch_failed(p_scan_id uuid, p_batch_index int)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.scans
  SET batches_failed = CASE
        WHEN batches_failed @> to_jsonb(p_batch_index) THEN batches_failed
        ELSE batches_failed || to_jsonb(p_batch_index)
      END
  WHERE id = p_scan_id;
$$;

GRANT EXECUTE ON FUNCTION public.mark_scan_batch_done(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_scan_batch_failed(uuid, int) TO authenticated;