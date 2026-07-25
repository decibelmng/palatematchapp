
REVOKE ALL ON FUNCTION public.admin_usage_summary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_user_list(int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_daily_active_users(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_usage_summary() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_user_list(int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_daily_active_users(int) TO service_role;
