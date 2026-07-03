DROP POLICY IF EXISTS "Bottles are publicly readable" ON public.bottles;

CREATE POLICY "Authenticated users can read bottles"
  ON public.bottles
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE SELECT ON public.bottles FROM anon;
GRANT SELECT ON public.bottles TO authenticated;