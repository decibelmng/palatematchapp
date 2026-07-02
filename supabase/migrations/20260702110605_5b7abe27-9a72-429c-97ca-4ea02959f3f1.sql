
CREATE OR REPLACE FUNCTION public.are_friends(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE status = 'accepted'
      AND ((requester_id = _a AND addressee_id = _b)
        OR (requester_id = _b AND addressee_id = _a))
  );
$$;

CREATE OR REPLACE FUNCTION public.search_users(q text, lim int DEFAULT 10)
RETURNS TABLE (user_id uuid, username text, display_name text)
LANGUAGE sql
STABLE
SECURITY INVOKER
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
