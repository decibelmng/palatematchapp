
CREATE TABLE public.invites (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token text NOT NULL UNIQUE,
  inviter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('friend','scan')),
  scan_id uuid REFERENCES public.scans(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_by uuid REFERENCES auth.users(id),
  redeemed_at timestamptz,
  redemption_count integer NOT NULL DEFAULT 0
);

CREATE INDEX invites_inviter_kind_idx ON public.invites(inviter_id, kind);
CREATE UNIQUE INDEX invites_friend_one_per_user_idx ON public.invites(inviter_id) WHERE kind = 'friend';
CREATE UNIQUE INDEX invites_scan_one_per_scan_idx ON public.invites(scan_id) WHERE kind = 'scan' AND scan_id IS NOT NULL;

GRANT SELECT, INSERT ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own invites" ON public.invites FOR SELECT TO authenticated
  USING (inviter_id = auth.uid());
CREATE POLICY "Users create own invites" ON public.invites FOR INSERT TO authenticated
  WITH CHECK (inviter_id = auth.uid());

-- Public reader for the invite landing page (works signed-out).
CREATE OR REPLACE FUNCTION public.get_invite(p_token text)
RETURNS TABLE(
  token text,
  kind text,
  inviter_id uuid,
  inviter_username text,
  inviter_display_name text,
  inviter_palate_code_red text,
  inviter_palate_code_white text,
  inviter_avatar_url text,
  scan_share_token text,
  scan_venue text,
  redeemed boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    i.token, i.kind, i.inviter_id,
    p.username, p.display_name, p.palate_code_red, p.palate_code_white, p.avatar_url,
    s.share_token,
    COALESCE(r.name, s.venue_raw_text) AS scan_venue,
    (i.redeemed_at IS NOT NULL) AS redeemed
  FROM public.invites i
  JOIN public.profiles p ON p.id = i.inviter_id
  LEFT JOIN public.scans s ON s.id = i.scan_id
  LEFT JOIN public.restaurants r ON r.id = s.restaurant_id
  WHERE i.token = p_token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.redeem_invite(p_token text)
RETURNS TABLE(kind text, inviter_id uuid, scan_share_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  v_kind text;
  v_inviter uuid;
  v_scan_share text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT i.kind, i.inviter_id, s.share_token
    INTO v_kind, v_inviter, v_scan_share
    FROM public.invites i
    LEFT JOIN public.scans s ON s.id = i.scan_id
    WHERE i.token = p_token
    LIMIT 1;

  IF v_inviter IS NULL THEN
    RAISE EXCEPTION 'Invite not found';
  END IF;

  IF v_inviter = uid THEN
    RETURN QUERY SELECT v_kind, v_inviter, v_scan_share;
    RETURN;
  END IF;

  -- Auto-accept: the inviter proactively shared the link.
  IF NOT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE (requester_id = v_inviter AND addressee_id = uid)
       OR (requester_id = uid AND addressee_id = v_inviter)
  ) THEN
    INSERT INTO public.friendships(requester_id, addressee_id, status, responded_at)
      VALUES (v_inviter, uid, 'accepted', now());
  ELSE
    UPDATE public.friendships
      SET status = 'accepted', responded_at = COALESCE(responded_at, now())
      WHERE ((requester_id = v_inviter AND addressee_id = uid)
          OR (requester_id = uid AND addressee_id = v_inviter))
        AND status = 'pending';
  END IF;

  UPDATE public.invites
    SET redemption_count = redemption_count + 1,
        redeemed_by = COALESCE(redeemed_by, uid),
        redeemed_at = COALESCE(redeemed_at, now())
    WHERE token = p_token;

  RETURN QUERY SELECT v_kind, v_inviter, v_scan_share;
END $$;

GRANT EXECUTE ON FUNCTION public.get_invite(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invite(text) TO authenticated;
