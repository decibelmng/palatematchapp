DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own roles" ON public.user_roles;
CREATE POLICY "Users can read their own roles"
  ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

INSERT INTO public.user_roles (user_id, role)
SELECT 'e3c4104c-56e7-4b6b-a359-5dc063302951'::uuid, 'admin'::public.app_role
WHERE EXISTS (
  SELECT 1 FROM auth.users WHERE id = 'e3c4104c-56e7-4b6b-a359-5dc063302951'::uuid
)
ON CONFLICT (user_id, role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_auth_audit_entries(
  p_since timestamptz DEFAULT now() - interval '72 hours',
  p_limit integer DEFAULT 500
)
RETURNS TABLE(
  id uuid,
  created_at timestamptz,
  ip_address text,
  action text,
  method text,
  path text,
  provider text,
  status text,
  error text,
  payload jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.created_at,
    a.ip_address::text,
    COALESCE(a.payload::jsonb ->> 'action', a.payload::jsonb ->> 'event', a.payload::jsonb ->> 'type') AS action,
    COALESCE(a.payload::jsonb ->> 'method', a.payload::jsonb -> 'request' ->> 'method') AS method,
    COALESCE(a.payload::jsonb ->> 'path', a.payload::jsonb -> 'request' ->> 'path') AS path,
    COALESCE(a.payload::jsonb ->> 'provider', a.payload::jsonb -> 'traits' ->> 'provider') AS provider,
    COALESCE(a.payload::jsonb ->> 'status', a.payload::jsonb -> 'response' ->> 'status_code') AS status,
    COALESCE(a.payload::jsonb ->> 'error', a.payload::jsonb -> 'error' ->> 'message', a.payload::jsonb ->> 'msg') AS error,
    a.payload::jsonb AS payload
  FROM auth.audit_log_entries AS a
  WHERE a.created_at >= COALESCE(p_since, now() - interval '72 hours')
  ORDER BY a.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
END $$;

REVOKE ALL ON FUNCTION public.admin_auth_audit_entries(timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_auth_audit_entries(timestamptz, integer) TO authenticated, service_role;