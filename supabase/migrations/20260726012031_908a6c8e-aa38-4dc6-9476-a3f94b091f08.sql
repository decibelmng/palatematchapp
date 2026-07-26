-- 1) Revocation support on somm invite codes
ALTER TABLE public.somm_invite_codes
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- 2) Admin user list including email from auth.users
CREATE OR REPLACE FUNCTION public.admin_user_list_with_email(
  p_admin_id uuid,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  username text,
  display_name text,
  email text,
  created_at timestamptz,
  last_seen_at timestamptz,
  ratings_count bigint,
  scans_count bigint,
  wishlist_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id, p.username, p.display_name,
    u.email::text,
    p.created_at, p.last_seen_at,
    COALESCE((SELECT COUNT(*) FROM public.ratings r  WHERE r.user_id = p.id), 0)::bigint,
    COALESCE((SELECT COUNT(*) FROM public.scans   s  WHERE s.user_id = p.id), 0)::bigint,
    COALESCE((SELECT COUNT(*) FROM public.wishlist w WHERE w.user_id = p.id), 0)::bigint
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p_admin_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM auth.users a WHERE a.id = p_admin_id) -- caller must be authenticated
  ORDER BY p.last_seen_at DESC NULLS LAST, p.created_at DESC
  LIMIT LEAST(COALESCE(p_limit, 500), 2000)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

REVOKE ALL ON FUNCTION public.admin_user_list_with_email(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_user_list_with_email(uuid, integer, integer) TO service_role;

-- 3) Admin: list somm invite codes with redeemer name/email
CREATE OR REPLACE FUNCTION public.admin_somm_codes_list()
RETURNS TABLE(
  code text,
  note text,
  created_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  used_by uuid,
  used_by_username text,
  used_by_display_name text,
  used_by_email text,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.code, c.note, c.created_at, c.used_at, c.revoked_at, c.used_by,
    p.username, p.display_name, u.email::text,
    CASE
      WHEN c.used_at IS NOT NULL THEN 'used'
      WHEN c.revoked_at IS NOT NULL THEN 'revoked'
      ELSE 'active'
    END AS status
  FROM public.somm_invite_codes c
  LEFT JOIN public.profiles p ON p.id = c.used_by
  LEFT JOIN auth.users u ON u.id = c.used_by
  ORDER BY c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_somm_codes_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_somm_codes_list() TO service_role;

-- 4) Admin: generate a new somm code (server-side unique code)
CREATE OR REPLACE FUNCTION public.admin_somm_code_generate(
  p_admin_id uuid,
  p_note text DEFAULT NULL
)
RETURNS TABLE(code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_attempts int := 0;
BEGIN
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'admin id required';
  END IF;
  LOOP
    v_code := 'SM-' || upper(substr(encode(gen_random_bytes(6), 'base64'), 1, 8));
    v_code := replace(replace(replace(v_code, '/', 'X'), '+', 'Y'), '=', 'Z');
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
END $$;

REVOKE ALL ON FUNCTION public.admin_somm_code_generate(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_somm_code_generate(uuid, text) TO service_role;

-- 5) Admin: revoke a code (only if unused)
CREATE OR REPLACE FUNCTION public.admin_somm_code_revoke(
  p_admin_id uuid,
  p_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_admin_id IS NULL THEN
    RAISE EXCEPTION 'admin id required';
  END IF;
  UPDATE public.somm_invite_codes
    SET revoked_at = now()
    WHERE code = p_code
      AND used_by IS NULL
      AND revoked_at IS NULL;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.admin_somm_code_revoke(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_somm_code_revoke(uuid, text) TO service_role;