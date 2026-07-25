
GRANT EXECUTE ON FUNCTION public.admin_consensus_gate_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_fp_drift()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_consensus_scan(boolean,real,integer,integer,real,real) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_consensus_validate(uuid) TO authenticated;
