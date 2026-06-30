
ALTER TABLE public.bottles
  ADD COLUMN IF NOT EXISTS tasting_note text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS bottles_added_by_idx ON public.bottles(added_by);

GRANT INSERT, UPDATE ON public.bottles TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can add bottles" ON public.bottles;
CREATE POLICY "Authenticated users can add bottles"
  ON public.bottles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = added_by);

DROP POLICY IF EXISTS "Adders can update their bottles" ON public.bottles;
CREATE POLICY "Adders can update their bottles"
  ON public.bottles FOR UPDATE TO authenticated
  USING (auth.uid() = added_by)
  WITH CHECK (auth.uid() = added_by);
