
-- ================================
-- 1. Profiles: add username & display_name
-- ================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS display_name text;

-- Backfill usernames deterministically
UPDATE public.profiles
SET username = 'user_' || substr(replace(id::text, '-', ''), 1, 8)
WHERE username IS NULL;

ALTER TABLE public.profiles ALTER COLUMN username SET NOT NULL;

-- Normalize username to lowercase on write
CREATE OR REPLACE FUNCTION public.normalize_username()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.username IS NOT NULL THEN
    NEW.username := lower(regexp_replace(NEW.username, '\s+', '', 'g'));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_normalize_username ON public.profiles;
CREATE TRIGGER profiles_normalize_username
  BEFORE INSERT OR UPDATE OF username ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.normalize_username();

-- Case-insensitive uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key ON public.profiles (username);
CREATE INDEX IF NOT EXISTS profiles_username_trgm ON public.profiles USING gin (username extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_display_name_trgm ON public.profiles USING gin (coalesce(display_name,'') extensions.gin_trgm_ops);

-- Update new-user trigger to also assign a username
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, 'user_' || substr(replace(NEW.id::text, '-', ''), 1, 8))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

-- Tighten profile SELECT: authenticated-only (was public)
DROP POLICY IF EXISTS "Profiles are publicly readable" ON public.profiles;
CREATE POLICY "Authenticated can read profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT ON public.profiles TO authenticated;

-- ================================
-- 2. Friendships
-- ================================
CREATE TABLE IF NOT EXISTS public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','declined','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id),
  CONSTRAINT friendships_unique_pair UNIQUE (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS friendships_requester_idx ON public.friendships (requester_id);
CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON public.friendships (addressee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO authenticated;
GRANT ALL ON public.friendships TO service_role;

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "See own friendships"
  ON public.friendships FOR SELECT TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "Send friend requests"
  ON public.friendships FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = requester_id AND status = 'pending');

CREATE POLICY "Respond or cancel"
  ON public.friendships FOR UPDATE TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
  WITH CHECK (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "Remove own connection"
  ON public.friendships FOR DELETE TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- ================================
-- 3. Helpers
-- ================================
CREATE OR REPLACE FUNCTION public.are_friends(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND ((requester_id = _a AND addressee_id = _b)
        OR (requester_id = _b AND addressee_id = _a))
  );
$$;

GRANT EXECUTE ON FUNCTION public.are_friends(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_users(q text, lim int DEFAULT 10)
RETURNS TABLE (user_id uuid, username text, display_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.username, p.display_name
  FROM public.profiles p
  WHERE p.id <> auth.uid()
    AND (
      p.username ILIKE lower(q) || '%'
      OR coalesce(p.display_name,'') ILIKE '%' || q || '%'
      OR word_similarity(lower(q), p.username) >= 0.4
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status IN ('accepted','pending')
        AND ((f.requester_id = auth.uid() AND f.addressee_id = p.id)
          OR (f.requester_id = p.id AND f.addressee_id = auth.uid()))
    )
  ORDER BY
    CASE WHEN p.username ILIKE lower(q) || '%' THEN 0 ELSE 1 END,
    p.username
  LIMIT least(coalesce(lim, 10), 25);
$$;

GRANT EXECUTE ON FUNCTION public.search_users(text, int) TO authenticated;
