-- Trigger function should not be callable by API roles at all.
REVOKE ALL ON FUNCTION public.bump_palate_version_from_rating() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bump_palate_version_from_rating() FROM anon;
REVOKE ALL ON FUNCTION public.bump_palate_version_from_rating() FROM authenticated;

-- set_benchmark: only authenticated may call.
REVOKE ALL ON FUNCTION public.set_benchmark(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_benchmark(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_benchmark(uuid, text, text) TO authenticated;