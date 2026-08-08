CREATE TABLE public.call_instrumentation (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_id uuid REFERENCES public.scans(id) ON DELETE CASCADE,
  is_catalog boolean NOT NULL,
  price_position text NOT NULL CHECK (price_position IN ('bottom-third','middle','top-third','unknown')),
  list_size integer NOT NULL,
  palate_version integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, scan_id)
);

GRANT SELECT, INSERT ON public.call_instrumentation TO authenticated;
GRANT ALL ON public.call_instrumentation TO service_role;

ALTER TABLE public.call_instrumentation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rows insert" ON public.call_instrumentation
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "own rows select" ON public.call_instrumentation
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "admins read all" ON public.call_instrumentation
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));