CREATE TABLE IF NOT EXISTS public.bottles_llm_staging (
  name text, producer text, region text, grape text, vintage integer, price_band text,
  fp_fresh real, fp_acid real, fp_tannin real, fp_fruit_dark real, fp_ripe real, fp_oak real, fp_body real, fp_savory real,
  ax_body real, ax_fruit_char real, ax_tannin real, ax_acidity real, ax_sweet real,
  critic_score integer, source text, type text
);
GRANT ALL ON public.bottles_llm_staging TO service_role;
ALTER TABLE public.bottles_llm_staging ENABLE ROW LEVEL SECURITY;