CREATE OR REPLACE FUNCTION public.admin_somm_code_generate(p_admin_id uuid, p_note text DEFAULT NULL::text)
 RETURNS TABLE(code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_code text;
  v_attempts int := 0;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
BEGIN
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'admin id required';
  END IF;
  LOOP
    v_code := 'SM-';
    FOR i IN 1..8 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.somm_invite_codes(code, issued_by, note)
        VALUES (v_code, p_admin_id, NULLIF(trim(coalesce(p_note, '')), ''));
      RETURN QUERY SELECT v_code;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      v_attempts := v_attempts + 1;
      IF v_attempts > 5 THEN RAISE; END IF;
    END;
  END LOOP;
END $function$;