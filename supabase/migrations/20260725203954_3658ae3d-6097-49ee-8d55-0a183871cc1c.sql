
-- =========================================================================
-- PHASE A/B: profile columns
-- =========================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS somm_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS somm_role text,
  ADD COLUMN IF NOT EXISTS establishment text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS bypass_code_used text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_visibility_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_visibility_check
  CHECK (visibility IN ('private','followers','public'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_somm_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_somm_status_check
  CHECK (somm_status IN ('none','pending','verified','revoked'));

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_somm_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_somm_role_check
  CHECK (somm_role IS NULL OR somm_role IN ('sommelier','store_owner','beverage_lead','other'));

-- Extend read policy to include public profiles (email/location are not stored on profiles).
DROP POLICY IF EXISTS "Read own or connected profiles" ON public.profiles;
CREATE POLICY "Read own, connected, or public profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR visibility = 'public'
    OR EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE ((f.requester_id = auth.uid() AND f.addressee_id = profiles.id)
          OR (f.requester_id = profiles.id AND f.addressee_id = auth.uid()))
    )
  );

-- =========================================================================
-- PHASE B: somm_invite_codes
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.somm_invite_codes (
  code        text PRIMARY KEY,
  issued_by   uuid,
  used_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at     timestamptz,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.somm_invite_codes TO authenticated;
GRANT ALL ON public.somm_invite_codes TO service_role;

ALTER TABLE public.somm_invite_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own invite codes readable" ON public.somm_invite_codes;
CREATE POLICY "own invite codes readable"
  ON public.somm_invite_codes
  FOR SELECT
  TO authenticated
  USING (used_by = auth.uid() OR issued_by = auth.uid());
-- No INSERT/UPDATE/DELETE policies → only service_role can mutate.

-- Redeem function: atomic claim + verify.
CREATE OR REPLACE FUNCTION public.redeem_somm_code(
  p_code text,
  p_role text DEFAULT NULL,
  p_establishment text DEFAULT NULL
)
RETURNS TABLE(somm_status text, verified_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_code_norm text := lower(trim(coalesce(p_code, '')));
  v_now timestamptz := now();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF v_code_norm = '' THEN RAISE EXCEPTION 'Invite code required'; END IF;
  IF p_role IS NOT NULL AND p_role NOT IN ('sommelier','store_owner','beverage_lead','other') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  UPDATE public.somm_invite_codes
    SET used_by = uid, used_at = v_now
    WHERE lower(code) = v_code_norm AND used_by IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or already-used invite code';
  END IF;

  UPDATE public.profiles
    SET somm_status = 'verified',
        verified_at = v_now,
        bypass_code_used = v_code_norm,
        somm_role = COALESCE(p_role, somm_role),
        establishment = COALESCE(p_establishment, establishment)
    WHERE id = uid;

  RETURN QUERY SELECT 'verified'::text, v_now;
END $$;

-- =========================================================================
-- PHASE C: follows (directed watching)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.follows (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followee_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now(),
  responded_at  timestamptz,
  UNIQUE (follower_id, followee_id),
  CHECK (follower_id <> followee_id),
  CHECK (status IN ('pending','accepted'))
);

CREATE INDEX IF NOT EXISTS follows_followee_idx ON public.follows(followee_id);
CREATE INDEX IF NOT EXISTS follows_follower_idx ON public.follows(follower_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.follows TO authenticated;
GRANT ALL ON public.follows TO service_role;

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read own follow edges" ON public.follows;
CREATE POLICY "read own follow edges"
  ON public.follows FOR SELECT TO authenticated
  USING (auth.uid() = follower_id OR auth.uid() = followee_id);

DROP POLICY IF EXISTS "follower may delete" ON public.follows;
CREATE POLICY "follower may delete"
  ON public.follows FOR DELETE TO authenticated
  USING (auth.uid() = follower_id OR auth.uid() = followee_id);

-- No direct INSERT/UPDATE policies — all writes go through the SECURITY DEFINER RPCs below.

CREATE OR REPLACE FUNCTION public.follow_user(p_followee uuid)
RETURNS TABLE(follow_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_vis text;
  v_status text;
  v_id uuid;
  v_existing_status text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF p_followee IS NULL OR p_followee = uid THEN RAISE EXCEPTION 'Invalid followee'; END IF;

  SELECT visibility INTO v_vis FROM public.profiles WHERE id = p_followee;
  IF v_vis IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;

  v_status := CASE WHEN v_vis = 'public' THEN 'accepted' ELSE 'pending' END;

  SELECT f.id, f.status INTO v_id, v_existing_status
    FROM public.follows f
    WHERE f.follower_id = uid AND f.followee_id = p_followee;

  IF v_id IS NOT NULL THEN
    -- Idempotent: if a pending edge exists and the target is now public, auto-accept.
    IF v_existing_status = 'pending' AND v_status = 'accepted' THEN
      UPDATE public.follows SET status='accepted', responded_at=now() WHERE id = v_id;
      RETURN QUERY SELECT v_id, 'accepted'::text;
    ELSE
      RETURN QUERY SELECT v_id, v_existing_status;
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.follows(follower_id, followee_id, status, responded_at)
    VALUES (uid, p_followee, v_status, CASE WHEN v_status='accepted' THEN now() ELSE NULL END)
    RETURNING id INTO v_id;
  RETURN QUERY SELECT v_id, v_status;
END $$;

CREATE OR REPLACE FUNCTION public.unfollow_user(p_followee uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.follows
    WHERE follower_id = auth.uid() AND followee_id = p_followee;
$$;

CREATE OR REPLACE FUNCTION public.respond_follow(p_follow_id uuid, p_accept boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF p_accept THEN
    UPDATE public.follows
      SET status='accepted', responded_at=now()
      WHERE id = p_follow_id AND followee_id = uid AND status='pending';
  ELSE
    DELETE FROM public.follows
      WHERE id = p_follow_id AND followee_id = uid;
  END IF;
END $$;

-- Public profile RPC — returns fields per visibility.
CREATE OR REPLACE FUNCTION public.get_public_profile(p_username text)
RETURNS TABLE(
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  visibility text,
  somm_status text,
  somm_role text,
  establishment text,
  palate_code_red text,
  palate_code_white text,
  n_rated integer,
  created_at timestamptz,
  follower_count bigint,
  following_count bigint,
  viewer_follow_status text,
  is_own boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  p record;
  v_is_own boolean;
  v_is_follower boolean;
  v_status text;
BEGIN
  SELECT * INTO p FROM public.profiles WHERE username = lower(trim(p_username));
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
      (SELECT count(*) FROM public.follows WHERE followee_id = p.id AND status='accepted'),
      (SELECT count(*) FROM public.follows WHERE follower_id = p.id AND status='accepted'),
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
      (SELECT count(*) FROM public.follows WHERE followee_id = p.id AND status='accepted'),
      (SELECT count(*) FROM public.follows WHERE follower_id = p.id AND status='accepted'),
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
    (SELECT count(*) FROM public.follows WHERE followee_id = p.id AND status='accepted'),
    (SELECT count(*) FROM public.follows WHERE follower_id = p.id AND status='accepted'),
    COALESCE(v_status, 'none'),
    v_is_own;
END $$;

GRANT EXECUTE ON FUNCTION public.get_public_profile(text) TO anon, authenticated;

-- =========================================================================
-- PHASE D: reliability + shadow somm observations
-- =========================================================================
ALTER TABLE public.fp_observations
  ADD COLUMN IF NOT EXISTS reliability_at_write real;

CREATE TABLE IF NOT EXISTS public.user_reliability (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rho         real NOT NULL DEFAULT 1.0,
  n_holdout   integer NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (rho >= 0 AND rho <= 1)
);

GRANT SELECT ON public.user_reliability TO authenticated;
GRANT ALL ON public.user_reliability TO service_role;

ALTER TABLE public.user_reliability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own reliability readable" ON public.user_reliability;
CREATE POLICY "own reliability readable"
  ON public.user_reliability FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
-- Writes: service_role only.

-- Reliability recompute — dormant heuristic; scores agreement with per-bottle mean
-- among high-consensus wines (≥8 raters). Never touches social metrics.
CREATE OR REPLACE FUNCTION public.admin_reliability_recompute()
RETURNS TABLE(users_touched bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint := 0;
BEGIN
  WITH bottle_consensus AS (
    SELECT bottle_id, AVG(stars)::real AS mu, COUNT(*)::int AS n_raters
      FROM public.ratings
      GROUP BY bottle_id
     HAVING COUNT(*) >= 8
  ),
  user_scores AS (
    SELECT r.user_id,
           1.0 - LEAST(1.0, AVG(ABS(r.stars - bc.mu)) / 2.0) AS rho,
           COUNT(*)::int AS n_holdout
      FROM public.ratings r
      JOIN bottle_consensus bc USING (bottle_id)
     GROUP BY r.user_id
  )
  INSERT INTO public.user_reliability(user_id, rho, n_holdout, updated_at)
  SELECT user_id, GREATEST(0, LEAST(1, rho))::real, n_holdout, now() FROM user_scores
  ON CONFLICT (user_id) DO UPDATE
    SET rho = EXCLUDED.rho,
        n_holdout = EXCLUDED.n_holdout,
        updated_at = now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN QUERY SELECT n;
END $$;

-- submit_somm_observation — writes to fp_observations with λ = base(tier)·ρ, mode='shadow'.
-- Guardrails (25% cap, floor, move cap) are enforced later by admin_fp_recompute_bottle.
CREATE OR REPLACE FUNCTION public.submit_somm_observation(
  p_bottle_id uuid,
  p_axis text,
  p_observed_value real,
  p_rationale text DEFAULT NULL
)
RETURNS TABLE(observation_id uuid, precision_out real, reliability real)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_status text;
  v_base real;
  v_rho real := 1.0;
  v_precision real;
  v_obs_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
  IF p_axis NOT IN ('fresh','acid','tannin','fruit_dark','ripe','oak','body','savory') THEN
    RAISE EXCEPTION 'Invalid axis: %', p_axis;
  END IF;
  IF p_observed_value < 0 OR p_observed_value > 1 THEN
    RAISE EXCEPTION 'observed_value must be in [0,1], got %', p_observed_value;
  END IF;

  SELECT somm_status INTO v_status FROM public.profiles WHERE id = uid;
  v_base := CASE WHEN v_status = 'verified' THEN 3.0 ELSE 1.0 END;

  SELECT rho INTO v_rho FROM public.user_reliability WHERE user_id = uid;
  v_rho := COALESCE(v_rho, 1.0);
  v_precision := v_base * v_rho;

  INSERT INTO public.fp_observations(
    bottle_id, axis, observed_value, precision,
    source_type, mode, author_id, rationale, reliability_at_write
  ) VALUES (
    p_bottle_id, p_axis, p_observed_value, v_precision,
    CASE WHEN v_status='verified' THEN 'somm_verified' ELSE 'user' END,
    'shadow', uid, p_rationale, v_rho
  )
  RETURNING id INTO v_obs_id;

  RETURN QUERY SELECT v_obs_id, v_precision, v_rho;
END $$;
