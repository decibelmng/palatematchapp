
CREATE TABLE public.scan_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  n_photos integer NOT NULL DEFAULT 0,
  total_wines integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  estimated_count integer NOT NULL DEFAULT 0,
  unreadable_count integer NOT NULL DEFAULT 0,
  wines jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_vision jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_logs TO authenticated;
GRANT ALL ON public.scan_logs TO service_role;

ALTER TABLE public.scan_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own scan logs"
  ON public.scan_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own scan logs"
  ON public.scan_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX scan_logs_user_created_idx ON public.scan_logs (user_id, created_at DESC);
