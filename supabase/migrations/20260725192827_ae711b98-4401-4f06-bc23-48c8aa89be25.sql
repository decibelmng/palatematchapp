CREATE OR REPLACE FUNCTION public.admin_table_list()
RETURNS TABLE(table_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.table_name::text
  FROM information_schema.tables c
  WHERE c.table_schema = 'public' AND c.table_type = 'BASE TABLE'
  ORDER BY c.table_name;
$$;

REVOKE ALL ON FUNCTION public.admin_table_list() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_table_list() FROM anon;
REVOKE ALL ON FUNCTION public.admin_table_list() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_table_list() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_table_columns(p_table text)
RETURNS TABLE(column_name text, data_type text, is_nullable text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.column_name::text, c.data_type::text, c.is_nullable::text
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = p_table
  ORDER BY c.ordinal_position;
$$;

REVOKE ALL ON FUNCTION public.admin_table_columns(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_table_columns(text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_table_columns(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_table_columns(text) TO service_role;