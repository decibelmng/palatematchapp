-- 1. Drop the flawed IS NOT NULL policies.
DROP POLICY IF EXISTS scans_share_public_read ON public.scans;
DROP POLICY IF EXISTS scan_wines_shared_read ON public.scan_wines;

-- 2. Constant-time text equality (no early-exit on first differing byte).
CREATE OR REPLACE FUNCTION public.ct_eq(a text, b text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  r int := 0;
  i int;
  la int;
  lb int;
BEGIN
  IF a IS NULL OR b IS NULL THEN
    RETURN false;
  END IF;
  la := length(a);
  lb := length(b);
  IF la <> lb THEN
    RETURN false;
  END IF;
  FOR i IN 1..la LOOP
    r := r | (ascii(substr(a, i, 1)) # ascii(substr(b, i, 1)));
  END LOOP;
  RETURN r = 0;
END
$$;

REVOKE ALL ON FUNCTION public.ct_eq(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ct_eq(text, text) TO anon, authenticated, service_role;

-- 3. Token-scoped read RPC. SECURITY DEFINER so it bypasses the (now
--    owner-only) RLS on scans / scan_wines, but only for a row whose token
--    matches the supplied one under constant-time compare.
CREATE OR REPLACE FUNCTION public.load_shared_scan(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scan_id uuid;
  v_scan record;
  v_wines jsonb;
  v_restaurant jsonb := NULL;
BEGIN
  IF p_token IS NULL OR length(p_token) < 8 OR length(p_token) > 64 THEN
    RETURN NULL;
  END IF;

  SELECT s.id INTO v_scan_id
  FROM public.scans s
  WHERE s.share_token IS NOT NULL
    AND public.ct_eq(s.share_token, p_token)
  LIMIT 1;

  IF v_scan_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT s.id, s.scanned_at, s.created_at, s.status, s.venue_raw_text,
         s.share_token, s.restaurant_id
    INTO v_scan
  FROM public.scans s
  WHERE s.id = v_scan_id;

  SELECT COALESCE(jsonb_agg(w ORDER BY w.batch_index), '[]'::jsonb) INTO v_wines
  FROM (
    SELECT id, scan_id, batch_index, producer, cuvee, vintage, wine_type,
           region, grape, price, price_amount, currency, format, raw_text,
           fp, fp_source, matched_bottle_id, match_score
    FROM public.scan_wines
    WHERE scan_id = v_scan_id
  ) w;

  IF v_scan.restaurant_id IS NOT NULL THEN
    SELECT to_jsonb(r) INTO v_restaurant
    FROM (
      SELECT id, name, city
      FROM public.restaurants
      WHERE id = v_scan.restaurant_id
    ) r;
  END IF;

  RETURN jsonb_build_object(
    'id',              v_scan.id,
    'scanned_at',      COALESCE(v_scan.scanned_at, v_scan.created_at),
    'status',          v_scan.status,
    'venue_raw_text',  v_scan.venue_raw_text,
    'share_token',     v_scan.share_token,
    'restaurant',      v_restaurant,
    'wines',           v_wines
  );
END
$$;

REVOKE ALL ON FUNCTION public.load_shared_scan(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.load_shared_scan(text) TO anon, authenticated, service_role;