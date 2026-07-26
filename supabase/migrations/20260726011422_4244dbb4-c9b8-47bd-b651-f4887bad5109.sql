CREATE TABLE public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('bug','confusing','idea','love','other','helpful_prompt')),
  message text,
  screen text,
  screenshot_url text,
  app_version text,
  context jsonb,
  source text NOT NULL DEFAULT 'button' CHECK (source IN ('button','prompt')),
  prompt_key text,
  rating text CHECK (rating IN ('up','down')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','resolved')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX feedback_created_at_idx ON public.feedback (created_at DESC);
CREATE INDEX feedback_category_idx ON public.feedback (category);
CREATE INDEX feedback_source_idx ON public.feedback (source);
CREATE INDEX feedback_status_idx ON public.feedback (status);
CREATE INDEX feedback_prompt_key_idx ON public.feedback (prompt_key) WHERE prompt_key IS NOT NULL;

GRANT SELECT, INSERT ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert their own feedback"
  ON public.feedback FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read their own feedback"
  ON public.feedback FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
