
CREATE OR REPLACE FUNCTION public.get_public_profile(p_username text)
 RETURNS TABLE(id uuid, username text, display_name text, avatar_url text, bio text, visibility text, somm_status text, somm_role text, establishment text, palate_code_red text, palate_code_white text, n_rated integer, created_at timestamp with time zone, follower_count bigint, following_count bigint, viewer_follow_status text, is_own boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  p public.profiles%ROWTYPE;
  v_is_own boolean;
  v_is_follower boolean;
  v_status text;
BEGIN
  -- Qualify profiles.username: the OUT column `username` from RETURNS TABLE
  -- is visible as a plpgsql variable and would otherwise collide here.
  SELECT pr.* INTO p FROM public.profiles pr
    WHERE pr.username = lower(trim(p_username));
  IF NOT FOUND THEN RETURN; END IF;

  v_is_own := (uid IS NOT NULL AND uid = p.id);
  v_is_follower := EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = uid AND f.followee_id = p.id AND f.status = 'accepted'
  );

  SELECT f.status INTO v_status FROM public.follows f
    WHERE f.follower_id = uid AND f.followee_id = p.id;

  -- Minimal card for private profiles the viewer isn't connected to.
  IF NOT v_is_own AND p.visibility = 'private' AND NOT v_is_follower THEN
    RETURN QUERY SELECT
      p.id, p.username, p.display_name, p.avatar_url, NULL::text,
      p.visibility, p.somm_status, p.somm_role, NULL::text,
      '·····'::text, '·····'::text, 0,
      p.created_at,
      (SELECT count(*) FROM public.follows fx WHERE fx.followee_id = p.id AND fx.status='accepted'),
      (SELECT count(*) FROM public.follows fx WHERE fx.follower_id = p.id AND fx.status='accepted'),
      COALESCE(v_status, 'none'),
      v_is_own;
    RETURN;
  END IF;

  -- Followers-only profile: same restriction unless viewer is a follower or owner.
  IF NOT v_is_own AND p.visibility = 'followers' AND NOT v_is_follower THEN
    RETURN QUERY SELECT
      p.id, p.username, p.display_name, p.avatar_url, NULL::text,
      p.visibility, p.somm_status, p.somm_role, NULL::text,
      '·····'::text, '·····'::text, 0,
      p.created_at,
      (SELECT count(*) FROM public.follows fx WHERE fx.followee_id = p.id AND fx.status='accepted'),
      (SELECT count(*) FROM public.follows fx WHERE fx.follower_id = p.id AND fx.status='accepted'),
      COALESCE(v_status, 'none'),
      v_is_own;
    RETURN;
  END IF;

  -- Full view.
  RETURN QUERY SELECT
    p.id, p.username, p.display_name, p.avatar_url, p.bio,
    p.visibility, p.somm_status, p.somm_role, p.establishment,
    p.palate_code_red, p.palate_code_white, p.n_rated,
    p.created_at,
    (SELECT count(*) FROM public.follows fx WHERE fx.followee_id = p.id AND fx.status='accepted'),
    (SELECT count(*) FROM public.follows fx WHERE fx.follower_id = p.id AND fx.status='accepted'),
    COALESCE(v_status, 'none'),
    v_is_own;
END $function$;
