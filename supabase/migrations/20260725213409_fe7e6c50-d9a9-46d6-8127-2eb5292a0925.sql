
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS profiles_last_seen_at_idx
  ON public.profiles (last_seen_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION public.admin_usage_summary()
RETURNS TABLE(
  total_users bigint,
  active_24h bigint,
  active_7d bigint,
  active_30d bigint,
  new_this_week bigint,
  median_ratings_per_user numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_user AS (
    SELECT user_id, COUNT(*)::bigint AS n FROM public.ratings GROUP BY user_id
  )
  SELECT
    (SELECT COUNT(*)::bigint FROM public.profiles),
    (SELECT COUNT(*)::bigint FROM public.profiles WHERE last_seen_at > now() - interval '24 hours'),
    (SELECT COUNT(*)::bigint FROM public.profiles WHERE last_seen_at > now() - interval '7 days'),
    (SELECT COUNT(*)::bigint FROM public.profiles WHERE last_seen_at > now() - interval '30 days'),
    (SELECT COUNT(*)::bigint FROM public.profiles WHERE created_at > now() - interval '7 days'),
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY n)::numeric FROM per_user);
$$;

CREATE OR REPLACE FUNCTION public.admin_user_list(p_limit int DEFAULT 500, p_offset int DEFAULT 0)
RETURNS TABLE(
  id uuid,
  username text,
  display_name text,
  created_at timestamptz,
  last_seen_at timestamptz,
  ratings_count bigint,
  scans_count bigint,
  wishlist_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id, p.username, p.display_name, p.created_at, p.last_seen_at,
    COALESCE((SELECT COUNT(*) FROM public.ratings r  WHERE r.user_id = p.id), 0)::bigint,
    COALESCE((SELECT COUNT(*) FROM public.scans   s  WHERE s.user_id = p.id), 0)::bigint,
    COALESCE((SELECT COUNT(*) FROM public.wishlist w WHERE w.user_id = p.id), 0)::bigint
  FROM public.profiles p
  ORDER BY p.last_seen_at DESC NULLS LAST, p.created_at DESC
  LIMIT LEAST(COALESCE(p_limit, 500), 2000)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.admin_daily_active_users(p_days int DEFAULT 30)
RETURNS TABLE(day date, users bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (last_seen_at AT TIME ZONE 'UTC')::date AS day,
         COUNT(*)::bigint AS users
  FROM public.profiles
  WHERE last_seen_at > now() - (LEAST(GREATEST(COALESCE(p_days, 30), 1), 90) || ' days')::interval
  GROUP BY 1
  ORDER BY 1 DESC;
$$;
