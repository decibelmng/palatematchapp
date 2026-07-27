-- Fix: expires_at shadowing between RETURNS TABLE OUT-columns and the
-- somm_consent_grants column. Alias every table, qualify every reference,
-- rename locals to v_*. No behavior change.

CREATE OR REPLACE FUNCTION public.somm_grant_generate()
 RETURNS TABLE(code text, expires_at timestamp with time zone, grant_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_expires_at timestamptz := now() + interval '30 minutes';
  v_id uuid;
  v_tries int := 0;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Kill any live unclaimed grants for this guest — one active code at a time.
  UPDATE public.somm_consent_grants AS g
     SET expires_at = now()
   WHERE g.guest_id = v_uid
     AND g.claimed_at IS NULL
     AND g.expires_at > now();

  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    BEGIN
      INSERT INTO public.somm_consent_grants AS g (guest_id, code, expires_at)
      VALUES (v_uid, v_code, v_expires_at)
      RETURNING g.id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_tries := v_tries + 1;
      IF v_tries > 8 THEN RAISE; END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT v_code, v_expires_at, v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.somm_grant_claim(p_code text)
 RETURNS TABLE(grant_id uuid, guest_id uuid, username text, display_name text, quiz_answers jsonb, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_grant_id uuid;
  v_guest_id uuid;
  v_expires_at timestamptz;
  v_claimed_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT p.somm_status INTO v_status
    FROM public.profiles p
   WHERE p.id = v_uid;
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'verified sommeliers only';
  END IF;

  SELECT g.id, g.guest_id, g.expires_at, g.claimed_at
    INTO v_grant_id, v_guest_id, v_expires_at, v_claimed_at
    FROM public.somm_consent_grants AS g
   WHERE g.code = upper(p_code)
     AND g.expires_at > now()
     AND (g.claimed_at IS NULL OR g.granted_to_somm_id = v_uid)
   LIMIT 1;

  IF v_grant_id IS NULL THEN
    RAISE EXCEPTION 'code invalid or expired';
  END IF;

  IF v_claimed_at IS NULL THEN
    UPDATE public.somm_consent_grants AS g
       SET claimed_at = now(), granted_to_somm_id = v_uid
     WHERE g.id = v_grant_id;
  END IF;

  RETURN QUERY
    SELECT v_grant_id, p.id, p.username, p.display_name, p.quiz_answers, v_expires_at
      FROM public.profiles p
     WHERE p.id = v_guest_id;
END $function$;

CREATE OR REPLACE FUNCTION public.somm_load_guest_scoring_bundle(p_guest_id uuid, p_grant_id uuid)
 RETURNS TABLE(bottle_id uuid, name text, producer text, region text, type text, vintage integer, fp_fresh real, fp_acid real, fp_tannin real, fp_fruit_dark real, fp_ripe real, fp_oak real, fp_body real, fp_savory real, stars integer, canon boolean, nemesis boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_ok boolean := false;
  v_visibility text;
  v_shareable boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT p.somm_status INTO v_status
    FROM public.profiles p
   WHERE p.id = v_uid;
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'verified sommeliers only';
  END IF;

  IF p_grant_id IS NOT NULL THEN
    SELECT true INTO v_ok
      FROM public.somm_consent_grants AS g
     WHERE g.id = p_grant_id
       AND g.guest_id = p_guest_id
       AND g.granted_to_somm_id = v_uid
       AND g.expires_at > now();
  END IF;

  IF NOT COALESCE(v_ok, false) THEN
    SELECT p.visibility, p.palate_shareable
      INTO v_visibility, v_shareable
      FROM public.profiles p
     WHERE p.id = p_guest_id;
    IF v_visibility = 'public' AND v_shareable = true THEN
      v_ok := true;
    END IF;
  END IF;

  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'no active consent for this guest';
  END IF;

  RETURN QUERY
    SELECT b.id, b.name, b.producer, b.region, b.type, b.vintage,
           b.fp_fresh, b.fp_acid, b.fp_tannin, b.fp_fruit_dark,
           b.fp_ripe, b.fp_oak, b.fp_body, b.fp_savory,
           r.stars,
           EXISTS (
             SELECT 1 FROM public.canon_wines c
              WHERE c.user_id = p_guest_id AND c.bottle_id = b.id
                AND c.tier = 'canon' AND c.replaced_at IS NULL
           ) AS canon,
           EXISTS (
             SELECT 1 FROM public.canon_wines c
              WHERE c.user_id = p_guest_id AND c.bottle_id = b.id
                AND c.tier = 'nemesis' AND c.replaced_at IS NULL
           ) AS nemesis
      FROM public.ratings r
      JOIN public.bottles b ON b.id = r.bottle_id
     WHERE r.user_id = p_guest_id;
END $function$;