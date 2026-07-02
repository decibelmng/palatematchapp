
DROP POLICY IF EXISTS "Authenticated users can insert restaurant wines" ON public.restaurant_wines;
DROP POLICY IF EXISTS "Authenticated users can update restaurant wines" ON public.restaurant_wines;
REVOKE INSERT, UPDATE ON public.restaurant_wines FROM authenticated;
