-- ============================================================================
-- 1. profiles: restrict SELECT to self + friends (any friendship status)
-- ============================================================================
DROP POLICY IF EXISTS "Authenticated can read profiles" ON public.profiles;

CREATE POLICY "Read own or connected profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE (f.requester_id = auth.uid() AND f.addressee_id = profiles.id)
         OR (f.requester_id = profiles.id AND f.addressee_id = auth.uid())
    )
  );

-- ============================================================================
-- 2. Username → id resolver (SECURITY DEFINER) so friend requests still work
--    now that arbitrary profile lookups are blocked by RLS above.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_username_to_id(p_username text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles
  WHERE username = lower(trim(p_username))
  LIMIT 1;
$$;

-- 3. Make search_users SECURITY DEFINER (returns only id/username/display_name).
CREATE OR REPLACE FUNCTION public.search_users(q text, lim integer DEFAULT 10)
RETURNS TABLE(user_id uuid, username text, display_name text)
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

-- ============================================================================
-- 4. Column-level REVOKE on identity columns exposed by public/authenticated
--    read policies. Client code no longer selects these columns.
-- ============================================================================
REVOKE SELECT (added_by)        ON public.bottles          FROM anon, authenticated;
REVOKE SELECT (created_by)      ON public.restaurants      FROM anon, authenticated;
REVOKE SELECT (added_by)        ON public.restaurant_wines FROM anon, authenticated;
REVOKE SELECT (source_scan_id)  ON public.restaurant_wines FROM anon, authenticated;

-- ============================================================================
-- 5. Lock down SECURITY DEFINER function EXECUTE grants.
--    - PUBLIC (implicit) EXECUTE stripped everywhere.
--    - Trigger-only functions: no EXECUTE for anon/authenticated.
--    - RPC-callable functions: authenticated only (anon revoked).
-- ============================================================================

-- Trigger-only SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bump_palate_version_from_rating() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ratings_cascade_benchmarks()      FROM PUBLIC, anon, authenticated;

-- Client-callable SECURITY DEFINER RPCs — authenticated only
REVOKE EXECUTE ON FUNCTION public.set_benchmark(uuid, text, text)                                 FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_benchmark(uuid, text, text)                                 TO authenticated;

REVOKE EXECUTE ON FUNCTION public.save_rating_with_cascade(uuid, integer, double precision)       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.save_rating_with_cascade(uuid, integer, double precision)       TO authenticated;

REVOKE EXECUTE ON FUNCTION public.restore_rating_and_benchmark(uuid, integer, text, double precision) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.restore_rating_and_benchmark(uuid, integer, text, double precision) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.search_users(text, integer)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.search_users(text, integer)          TO authenticated;

REVOKE EXECUTE ON FUNCTION public.resolve_username_to_id(text)         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolve_username_to_id(text)         TO authenticated;
