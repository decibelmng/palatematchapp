REVOKE SELECT (bypass_code_used) ON public.profiles FROM anon, authenticated;
GRANT SELECT (bypass_code_used) ON public.profiles TO service_role;