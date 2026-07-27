
-- 1) Per-occasion consent grants ─────────────────────────────────
CREATE TABLE public.somm_consent_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL,
  granted_to_somm_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX somm_consent_grants_code_live_uidx
  ON public.somm_consent_grants (code)
  WHERE claimed_at IS NULL;

CREATE INDEX somm_consent_grants_guest_idx ON public.somm_consent_grants (guest_id, created_at DESC);
CREATE INDEX somm_consent_grants_somm_idx ON public.somm_consent_grants (granted_to_somm_id, claimed_at DESC);

GRANT SELECT, INSERT ON public.somm_consent_grants TO authenticated;
GRANT ALL ON public.somm_consent_grants TO service_role;
ALTER TABLE public.somm_consent_grants ENABLE ROW LEVEL SECURITY;

-- Guests can see their own grants (to display the code + status).
CREATE POLICY "guests read own grants"
  ON public.somm_consent_grants FOR SELECT TO authenticated
  USING (guest_id = auth.uid());

-- Claiming somms can see grants they hold — useful for debugging & for
-- server functions that read as the somm.
CREATE POLICY "claiming somm reads their grant"
  ON public.somm_consent_grants FOR SELECT TO authenticated
  USING (granted_to_somm_id = auth.uid());

-- Direct inserts (bypassing the SECURITY DEFINER generator) are also
-- allowed but only for a guest's own row — the generator is the normal
-- path and enforces the 30-min expiry.
CREATE POLICY "guests insert own grant"
  ON public.somm_consent_grants FOR INSERT TO authenticated
  WITH CHECK (guest_id = auth.uid() AND granted_to_somm_id IS NULL);

-- No UPDATE/DELETE policies. All state transitions happen through
-- security-definer functions below.


-- 2) Access log — the guest-visible accountability record ─────────
CREATE TABLE public.somm_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  somm_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  establishment text,
  candidate_count integer NOT NULL,
  kind text NOT NULL DEFAULT 'table-call',
  grant_id uuid REFERENCES public.somm_consent_grants(id) ON DELETE SET NULL,
  via text NOT NULL CHECK (via IN ('code','public')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX somm_access_log_guest_idx ON public.somm_access_log (guest_id, occurred_at DESC);
CREATE INDEX somm_access_log_somm_idx  ON public.somm_access_log (somm_id, occurred_at DESC);

GRANT SELECT, INSERT ON public.somm_access_log TO authenticated;
GRANT ALL ON public.somm_access_log TO service_role;
ALTER TABLE public.somm_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guests read own access log"
  ON public.somm_access_log FOR SELECT TO authenticated
  USING (guest_id = auth.uid());

CREATE POLICY "somms read own writes"
  ON public.somm_access_log FOR SELECT TO authenticated
  USING (somm_id = auth.uid());

-- Insert only your own writes, and only when you're a verified somm.
CREATE POLICY "verified somms record own access"
  ON public.somm_access_log FOR INSERT TO authenticated
  WITH CHECK (
    somm_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.somm_status = 'verified'
    )
  );


-- 3) Guest generates a code ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.somm_grant_generate()
RETURNS TABLE(code text, expires_at timestamptz, grant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
  v_expires timestamptz := now() + interval '30 minutes';
  v_id uuid;
  v_tries int := 0;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- readable
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  -- Kill any live unclaimed grants for this guest — one active code at a time.
  UPDATE somm_consent_grants
     SET expires_at = now()
   WHERE guest_id = v_uid AND claimed_at IS NULL AND expires_at > now();

  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    BEGIN
      INSERT INTO somm_consent_grants (guest_id, code, expires_at)
      VALUES (v_uid, v_code, v_expires)
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      v_tries := v_tries + 1;
      IF v_tries > 8 THEN RAISE; END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT v_code, v_expires, v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.somm_grant_generate() TO authenticated;


-- 4) Verified somm claims a code ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.somm_grant_claim(p_code text)
RETURNS TABLE(
  grant_id uuid,
  guest_id uuid,
  username text,
  display_name text,
  quiz_answers jsonb,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_grant record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT somm_status INTO v_status FROM profiles WHERE id = v_uid;
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'verified sommeliers only';
  END IF;

  SELECT * INTO v_grant
    FROM somm_consent_grants
   WHERE code = upper(p_code)
     AND expires_at > now()
     AND (claimed_at IS NULL OR granted_to_somm_id = v_uid)
   LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'code invalid or expired'; END IF;

  IF v_grant.claimed_at IS NULL THEN
    UPDATE somm_consent_grants
       SET claimed_at = now(), granted_to_somm_id = v_uid
     WHERE id = v_grant.id;
  END IF;

  RETURN QUERY
    SELECT v_grant.id, p.id, p.username, p.display_name, p.quiz_answers, v_grant.expires_at
      FROM profiles p WHERE p.id = v_grant.guest_id;
END $$;
GRANT EXECUTE ON FUNCTION public.somm_grant_claim(text) TO authenticated;


-- 5) The single narrow admin-bypass: load a guest scoring bundle.
--    Enforces consent inside SQL. Callers use context.supabase (RLS as
--    the somm) — no service-role client anywhere.
CREATE OR REPLACE FUNCTION public.somm_load_guest_scoring_bundle(
  p_guest_id uuid,
  p_grant_id uuid
)
RETURNS TABLE(
  bottle_id uuid, name text, producer text, region text, type text, vintage int,
  fp_fresh real, fp_acid real, fp_tannin real, fp_fruit_dark real,
  fp_ripe real, fp_oak real, fp_body real, fp_savory real,
  stars int, canon boolean, nemesis boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_ok boolean := false;
  v_visibility text;
  v_shareable boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT somm_status INTO v_status FROM profiles WHERE id = v_uid;
  IF v_status IS DISTINCT FROM 'verified' THEN
    RAISE EXCEPTION 'verified sommeliers only';
  END IF;

  IF p_grant_id IS NOT NULL THEN
    SELECT true INTO v_ok
      FROM somm_consent_grants
     WHERE id = p_grant_id
       AND guest_id = p_guest_id
       AND granted_to_somm_id = v_uid
       AND expires_at > now();
  END IF;

  IF NOT COALESCE(v_ok, false) THEN
    SELECT visibility, palate_shareable INTO v_visibility, v_shareable
      FROM profiles WHERE id = p_guest_id;
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
             SELECT 1 FROM canon_wines c
              WHERE c.user_id = p_guest_id AND c.bottle_id = b.id
                AND c.tier = 'canon' AND c.replaced_at IS NULL
           ) AS canon,
           EXISTS (
             SELECT 1 FROM canon_wines c
              WHERE c.user_id = p_guest_id AND c.bottle_id = b.id
                AND c.tier = 'nemesis' AND c.replaced_at IS NULL
           ) AS nemesis
      FROM ratings r
      JOIN bottles b ON b.id = r.bottle_id
     WHERE r.user_id = p_guest_id;
END $$;
GRANT EXECUTE ON FUNCTION public.somm_load_guest_scoring_bundle(uuid, uuid) TO authenticated;
