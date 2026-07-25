CREATE OR REPLACE FUNCTION public.admin_group_count(p_table text, p_column text)
RETURNS TABLE(value text, n bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF p_table IS NULL OR p_column IS NULL
     OR p_table !~ '^[a-z_][a-z0-9_]*$'
     OR p_column !~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid identifier';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name = p_column
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Unknown table or column';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT (%I)::text AS value, COUNT(*)::bigint AS n FROM public.%I GROUP BY %I ORDER BY n DESC, value ASC NULLS LAST LIMIT 1000',
    p_column, p_table, p_column
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_group_count(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_group_count(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_group_count(text, text) TO service_role;